/** Adapt Doubao recognition and TTS to the shared tool/turn controller. */
export function createDoubaoControlChannel({
  request,
  speak,
  onEvent,
  onError = () => {},
  onCancel = () => {},
  signal,
}) {
  const messages = [];
  let closed = false;
  let epoch = 0;
  let pending = null;
  let transcript = '';
  let spokenResponse = null;
  let externalAudio = false;
  let rounds = 0;
  let activeResponse = null;
  const emit = (event) => !closed && onEvent?.(event);
  const cancel = () => {
    const id = activeResponse;
    const wasPlaying = externalAudio;
    activeResponse = null;
    epoch++;
    pending?.abort();
    pending = null;
    spokenResponse = null;
    externalAudio = false;
    onCancel();
    if (wasPlaying) void emit({ type: 'output_audio_buffer.stopped' });
    if (id)
      void emit({
        type: 'response.done',
        response: { id, status: 'cancelled' },
      });
  };
  const add = (message) => {
    messages.push(message);
    // Trim complete turns, never split an assistant/tool-result pair.
    while (messages.length > 60) {
      const next = messages.findIndex(
        (item, i) => i > 0 && item.role === 'user',
      );
      if (next < 0) break;
      messages.splice(0, next);
    }
  };
  const generate = async (options) => {
    if (closed || pending) return;
    if (++rounds > 16) {
      onError(new Error('Voice tool round limit reached'));
      return;
    }
    const generation = ++epoch;
    const abort = new AbortController();
    pending = abort;
    const responseId = `gev-doubao-${generation}`;
    activeResponse = responseId;
    const current = () =>
      !closed && generation === epoch && !abort.signal.aborted;
    await emit({ type: 'response.created', response: { id: responseId } });
    try {
      const result = await request(
        messages.map(({ _id, ...message }) => message),
        {
          signal: abort.signal,
          instructions: options?.instructions,
        },
      );
      if (!current()) return;
      pending = null;
      add(result);
      if (result.tool_calls?.length) {
        for (const call of result.tool_calls) {
          if (!current()) return;
          await emit({
            type: 'response.function_call_arguments.done',
            response_id: responseId,
            item_id: call.id,
            call_id: call.id,
            name: call.function.name,
            arguments: call.function.arguments,
          });
        }
        if (current()) {
          activeResponse = null;
          await emit({
            type: 'response.done',
            response: { id: responseId, status: 'completed' },
          });
        }
      } else {
        const text = result.content || '';
        await emit({
          type: 'response.text.done',
          response_id: responseId,
          text,
        });
        if (!current()) return;
        if (text) {
          spokenResponse = responseId;
          speak(text);
        } else
          await emit({
            type: 'response.done',
            response: { id: responseId, status: 'completed' },
          });
      }
    } catch (error) {
      if (current()) onError(error);
    } finally {
      if (pending === abort) pending = null;
    }
  };
  const acceptText = (text) => {
    if (!text.trim()) return;
    rounds = 0;
    add({ role: 'user', content: text });
  };
  const discardIncompleteTools = () => {
    const answered = new Set(
      messages
        .filter((message) => message.role === 'tool')
        .map((message) => message.tool_call_id),
    );
    const valid = new Set();
    for (let i = messages.length - 1; i >= 0; i--) {
      const calls = messages[i].tool_calls;
      if (!calls) continue;
      if (calls.every((call) => answered.has(call.id)))
        calls.forEach((call) => valid.add(call.id));
      else messages.splice(i, 1);
    }
    for (let i = messages.length - 1; i >= 0; i--)
      if (messages[i].role === 'tool' && !valid.has(messages[i].tool_call_id))
        messages.splice(i, 1);
  };
  const dispose = () => {
    closed = true;
    cancel();
    messages.length = 0;
    signal?.removeEventListener('abort', dispose);
  };
  signal?.addEventListener('abort', dispose, { once: true });
  if (signal?.aborted) dispose();
  return {
    supportsOutOfBand: false,
    get readyState() {
      return closed ? 'closed' : 'open';
    },
    dispose,
    close: dispose,
    interrupt() {
      cancel();
      discardIncompleteTools();
      rounds = 0;
    },
    send(data) {
      if (closed) return;
      const event = JSON.parse(data);
      if (
        event.type === 'response.cancel' ||
        event.type === 'output_audio_buffer.clear'
      ) {
        cancel();
      } else if (event.type === 'conversation.item.delete') {
        const index = messages.findIndex(
          (message) => message._id === event.item_id,
        );
        if (index >= 0) messages.splice(index, 1);
      } else if (event.type === 'conversation.item.create') {
        const item = event.item;
        if (item?.type === 'function_call_output') {
          if (
            messages.some((message) =>
              message.tool_calls?.some((call) => call.id === item.call_id),
            )
          )
            add({
              role: 'tool',
              tool_call_id: item.call_id,
              content: item.output,
            });
        } else if (
          item?.type === 'message' &&
          ['user', 'system'].includes(item.role)
        ) {
          const content = (item.content || []).flatMap((part) =>
            part.type === 'input_text'
              ? [
                  {
                    type: 'text',
                    text:
                      item.role === 'system'
                        ? JSON.stringify({ map_event_data: part.text })
                        : part.text,
                  },
                ]
              : part.type === 'input_image'
                ? [{ type: 'image_url', image_url: { url: part.image_url } }]
                : [],
          );
          add({ role: 'user', content, _id: item.id });
        }
      } else if (event.type === 'response.create') {
        // Progress narration is out of band and must not execute another turn.
        if (event.response?.conversation !== 'none')
          void generate(event.response);
      }
    },
    /** True means the native reply must not reach shared state or playback. */
    handleFrame(frame) {
      if (closed) return true;
      if (frame.event === 450) {
        cancel();
        discardIncompleteTools();
        transcript = '';
        void emit({ type: 'input_audio_buffer.speech_started' });
      } else if (frame.event === 451) {
        const results = frame.json?.results || [];
        const text = results.map((result) => result.text || '').join('');
        if (text) transcript = text;
      } else if (frame.event === 459) {
        if (transcript.trim()) {
          const text = transcript;
          transcript = '';
          acceptText(text);
          void emit({
            type: 'conversation.item.input_audio_transcription.completed',
            transcript: text,
          });
          void generate();
        }
      } else if (frame.event === 350) {
        externalAudio =
          Boolean(spokenResponse) && frame.json?.tts_type === 'chat_tts_text';
        if (externalAudio) void emit({ type: 'output_audio_buffer.started' });
      } else if (frame.event === 352) {
        return !externalAudio;
      } else if (frame.event === 359 && externalAudio && spokenResponse) {
        const id = spokenResponse;
        externalAudio = false;
        spokenResponse = null;
        activeResponse = null;
        void emit({ type: 'output_audio_buffer.stopped' });
        void emit({
          type: 'response.done',
          response: { id, status: 'completed' },
        });
      } else if ([51, 153, 152].includes(frame.event)) return false;
      return true;
    },
  };
}
