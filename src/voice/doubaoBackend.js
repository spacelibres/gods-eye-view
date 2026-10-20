import { DEFAULT_VOICE_TIER, resolveVoiceModel } from './voiceCost.js';

/** A v4 UUID from the platform's own crypto, which the browser provides. */
const newSessionId = () => globalThis.crypto.randomUUID();

/**
 * Volcengine Doubao realtime voice backend.
 *
 * The protocol is binary, and every detail below was read off frames the live
 * service accepted or rejected — the public samples disagree with each other,
 * and guessing any one of these produced a session that connected and stayed
 * silent.
 *
 * Frame layout (big-endian lengths):
 *
 *   byte 0  version(4 bits) | header size(4 bits)      always 0x11
 *   byte 1  message type(4) | flags(4)                 0x1/0x2 = client frames
 *   byte 2  serialization(4) | compression(4)          0x10 = JSON, 0 = none
 *   byte 3  reserved                                    0x00
 *   u32     event id
 *   ...     event-specific body
 *
 * Four findings that cost the most time, each now a test:
 *
 * - The body is **never compressed**. The samples gzip it; this service answers
 *   `invalid char \x1f\x8b` and closes.
 * - The header is **four bytes**, not the eight the samples imply.
 * - The connection frame's payload must be real JSON. An empty `{}` is refused
 *   with `unexpected end of JSON input`.
 * - Every frame is sent **binary**. A `Uint8Array`/`Buffer` handed to a
 *   WebSocket's `send` goes out as a *text* frame unless it is wrapped, and the
 *   service then sees a payload it cannot decode and never answers.
 *
 * The module runs in the browser, so it uses `Uint8Array` throughout rather
 * than Node's `Buffer`.
 */

/**
 * A same-origin path the server relays to the vendor.
 *
 * The browser cannot attach headers to a WebSocket — `new WebSocket(url,
 * { headers })` throws `The subprotocol '[object Object]' is invalid`, because
 * the second argument is the protocol list. Volcengine signs its socket with
 * `X-Api-*` headers, so the page connects here and the server's relay adds the
 * credential on the way out.
 */
const DEFAULT_SOCKET_URL = '/api/doubao/socket';

/** Event ids, as the service numbers them. */
export const DOUBAO_EVENTS = Object.freeze({
  startConnection: 1,
  startSession: 100,
  finishSession: 102,
  taskRequest: 200,
  chatTextQuery: 501,
  connectionStarted: 50,
  connectionFailed: 51,
  sessionStarted: 150,
  sessionFailed: 153,
  sessionFinished: 152,
  ttsSentenceStart: 350,
  ttsResponse: 352,
  ttsSentenceEnd: 351,
  ttsEnded: 359,
  asrResponse: 451,
  asrEnded: 459,
  chatResponse: 550,
  chatEnded: 559,
});

const MSG = Object.freeze({ error: 0xf });

/** Header bytes for a JSON client frame. */
const JSON_HEADER = Object.freeze([0x11, 0x14, 0x10, 0x00]);
/** Header bytes for a raw audio client frame. */
const AUDIO_HEADER = Object.freeze([0x11, 0x20, 0x00, 0x00]);

/** Concatenate byte arrays into one `Uint8Array`. */
function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** A big-endian u32. */
function u32(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, false);
  return out;
}

/** UTF-8 bytes of a string. */
function utf8(text) {
  return new TextEncoder().encode(text);
}

/**
 * A full client request carrying JSON.
 *
 * @param {number} event
 * @param {object} payload
 * @param {string} [sessionId] Present on everything after StartSession.
 * @returns {Uint8Array}
 */
export function encodeJsonFrame(event, payload, sessionId = '') {
  const body = utf8(JSON.stringify(payload));
  const parts = [new Uint8Array(JSON_HEADER), u32(event)];
  if (sessionId) {
    const id = utf8(sessionId);
    parts.push(u32(id.length), id);
  }
  parts.push(u32(body.length), body);
  return concat(parts);
}

/**
 * A client audio frame.
 *
 * `event` 200 is the task request this service expects for streamed audio.
 *
 * @param {number} event
 * @param {Uint8Array} pcm
 * @param {string} [sessionId]
 * @returns {Uint8Array}
 */
export function encodeAudioFrame(event, pcm, sessionId = '') {
  const parts = [new Uint8Array(AUDIO_HEADER), u32(event)];
  if (sessionId) {
    const id = utf8(sessionId);
    parts.push(u32(id.length), id);
  }
  parts.push(u32(pcm.length), pcm);
  return concat(parts);
}

/** True for the UUID shape the service uses for session ids. */
function isSessionId(bytes) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    new TextDecoder().decode(bytes),
  );
}

/**
 * Parse one server frame.
 *
 * Server frames come in two shapes. Text events carry `event + sessionId +
 * json`; audio events carry `event + sessionId + pcm`. The declared length is
 * what distinguishes them, so the reader trusts the frame rather than a table.
 *
 * @param {ArrayBuffer|Uint8Array} data
 * @returns {{type: number, flags: number, event: number|null,
 *   sessionId: string, json: object|null, audio: Uint8Array|null,
 *   error: string|null}}
 */
export function decodeServerFrame(data) {
  const buffer =
    data instanceof Uint8Array
      ? data
      : new Uint8Array(data ?? new ArrayBuffer(0));
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );
  const frame = {
    type: (buffer[1] ?? 0) >> 4,
    flags: (buffer[1] ?? 0) & 0x0f,
    event: null,
    sessionId: '',
    json: null,
    audio: null,
    error: null,
  };
  if (frame.type === MSG.error) {
    frame.error = new TextDecoder()
      .decode(buffer.subarray(8))
      .replace(/^\0+/, '');
    return frame;
  }
  if (buffer.length < 8) return frame;
  frame.event = view.getUint32(4, false);
  let offset = 8;
  // A session id is a UUID, and every text event after StartSession carries
  // one. The length field alone cannot tell it apart from a short payload — a
  // two-byte `{}` body reads as a two-byte id — so the shape is checked too.
  if (buffer.length >= offset + 4) {
    const idLength = view.getUint32(offset, false);
    if (
      idLength === 36 &&
      buffer.length >= offset + 4 + idLength &&
      isSessionId(buffer.subarray(offset + 4, offset + 4 + idLength))
    ) {
      frame.sessionId = new TextDecoder().decode(
        buffer.subarray(offset + 4, offset + 4 + idLength),
      );
      offset += 4 + idLength;
    }
  }
  if (buffer.length < offset + 4) return frame;
  const payloadLength = view.getUint32(offset, false);
  offset += 4;
  const end = Math.min(buffer.length, offset + payloadLength);
  const body = buffer.subarray(offset, end);
  if (frame.event === DOUBAO_EVENTS.ttsResponse) {
    // Audio: the body is PCM16, no JSON wrapper.
    frame.audio = body;
    return frame;
  }
  const text = new TextDecoder().decode(body);
  if (text.trimStart().startsWith('{') || text.trimStart().startsWith('[')) {
    try {
      frame.json = JSON.parse(text);
    } catch {
      frame.json = null;
    }
  }
  return frame;
}

/**
 * Translate one Doubao frame into the event shape the shared handler reads.
 *
 * The rest of the voice stack keys off `payload.type` strings — that is what
 * the OpenAI and DashScope sessions emit. Doubao numbers its events, so this
 * is the one place the two vocabularies meet. Returning `null` means the frame
 * carries nothing the UI acts on (it is still counted for diagnostics).
 *
 * @param {ReturnType<typeof decodeServerFrame>} frame
 * @returns {{type: string, delta?: string} | null}
 */
export function translateDoubaoFrame(frame) {
  if (!frame || frame.event == null) return null;
  switch (frame.event) {
    case DOUBAO_EVENTS.chatResponse:
      return { type: 'response.text.delta', delta: frame.json?.content ?? '' };
    case DOUBAO_EVENTS.chatEnded:
      return { type: 'response.done' };
    case DOUBAO_EVENTS.ttsSentenceStart:
      return { type: 'response.audio.started' };
    case DOUBAO_EVENTS.asrResponse:
      return { type: 'conversation.item.input_audio_transcription.delta' };
    case DOUBAO_EVENTS.asrEnded:
      return { type: 'input_audio_buffer.speech_stopped' };
    case DOUBAO_EVENTS.sessionFailed:
      return {
        type: 'error',
        error: { message: frame.error || 'Session failed' },
      };
    case DOUBAO_EVENTS.sessionFinished:
      return { type: 'session.finished' };
    default:
      return null;
  }
}

/**
 * Send bytes as a binary WebSocket frame.
 *
 * A `Uint8Array` handed straight to `send` goes out as *text* in browsers, and
 * the vendor then receives a frame it cannot decode. Wrapping the exact slice
 * in an `ArrayBuffer` is what marks it binary.
 */
function sendBinary(socket, bytes) {
  socket.send(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
}

/**
 * Create the Doubao backend.
 *
 * @param {{tokenEndpoint?: string, socketUrl?: string, tokenTransport?: Function,
 *   WebSocketImpl?: Function, origin?: string, timeoutMs?: number,
 *   signal?: AbortSignal}} [options]
 */
export function createDoubaoBackend({
  tokenEndpoint = '/api/doubao/token',
  socketUrl = DEFAULT_SOCKET_URL,
  tokenTransport = (...args) => fetch(...args),
  WebSocketImpl = (...args) => new WebSocket(...args),
  origin = globalThis.location?.origin,
  timeoutMs = 30_000,
  signal: lifetime,
} = {}) {
  const scoped = (signal) =>
    AbortSignal.any(
      [lifetime, signal, AbortSignal.timeout(timeoutMs)].filter(Boolean),
    );

  return Object.freeze({
    protocol: 'doubao-realtime',
    transport: 'websocket',
    // The session asks for 24 kHz PCM out; input is 16 kHz PCM16.
    audio: { inputHz: 16_000, outputHz: 24_000 },
    // Microphone audio goes on the wire as raw PCM in a binary frame, not as
    // base64 inside a JSON event.
    audioEncoding: 'pcm',
    events: DOUBAO_EVENTS,
    // Binary transport: the session hands raw frames here, and audio arrives as
    // PCM blocks rather than base64 in a JSON field.
    decodeFrame: (data) => decodeServerFrame(data),
    translateFrame: (frame) => translateDoubaoFrame(frame),

    async requestToken({ tier = DEFAULT_VOICE_TIER, signal } = {}) {
      signal = scoped(signal);
      signal.throwIfAborted();
      const url = `${tokenEndpoint}?${new URLSearchParams({
        tier: resolveVoiceModel(tier).tier,
      })}`;
      const response = await tokenTransport(url, {
        signal,
        cache: 'no-store',
        redirect: 'error',
      });
      signal.throwIfAborted();
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          data?.error || `Doubao token failed: HTTP ${response.status}`,
        );
      }
      if (!data?.appId || !data?.accessToken) {
        throw new Error('Doubao credential response is incomplete');
      }
      return {
        token: data.accessToken,
        appId: data.appId,
        model: data.model ?? null,
        tier: response.headers?.get?.('X-GEV-Voice-Tier') || null,
        transcribeModel: null,
        expiresAt: null,
      };
    },

    /**
     * Open the socket.
     *
     * The handshake is two frames: StartConnection, then — once the service
     * answers ConnectionStarted — StartSession with the TTS and dialog setup.
     * Waiting for the answer matters: sending both at once is silently
     * ignored.
     */
    openSocket({ model, signal, onSession }) {
      signal = scoped(signal);
      signal.throwIfAborted();
      // A relative path is resolved against the page's own origin; the server's
      // relay then adds the headers the vendor requires, which this code
      // cannot do. Outside a page (tests, a worker) the origin may be absent.
      const target =
        socketUrl.startsWith('/') && origin
          ? `${origin.replace(/^http/, 'ws')}${socketUrl}`
          : socketUrl;
      const socket = WebSocketImpl(target);
      socket.binaryType = 'arraybuffer';
      const sessionId = newSessionId();
      let started = false;

      return new Promise((resolve, reject) => {
        const fail = (error) => {
          cleanup();
          try {
            socket.close();
          } catch {
            // Closing an unopened socket is not an error.
          }
          reject(error);
        };
        const onAbort = () => fail(new Error('Doubao socket aborted'));
        const cleanup = () => {
          signal?.removeEventListener?.('abort', onAbort);
          socket.removeEventListener?.('error', onError);
        };
        const onError = () => fail(new Error('Doubao socket failed to open'));
        signal?.addEventListener?.('abort', onAbort, { once: true });
        socket.addEventListener('error', onError);
        socket.addEventListener('open', () => {
          // A non-empty payload: an empty object is refused outright.
          sendBinary(
            socket,
            encodeJsonFrame(DOUBAO_EVENTS.startConnection, {
              dialogue: { bot_name: 'Gev' },
            }),
          );
        });
        socket.addEventListener('message', (event) => {
          if (started) return;
          const frame = decodeServerFrame(event.data);
          if (frame.event === DOUBAO_EVENTS.connectionFailed || frame.error) {
            fail(new Error(frame.error || 'Doubao connection refused'));
            return;
          }
          if (frame.event !== DOUBAO_EVENTS.connectionStarted) return;
          started = true;
          cleanup();
          sendBinary(
            socket,
            encodeJsonFrame(
              DOUBAO_EVENTS.startSession,
              {
                tts: {
                  audio_config: {
                    channel: 1,
                    format: 'pcm',
                    sample_rate: 24_000,
                  },
                },
                dialog: {
                  bot_name: 'Gev',
                  system_role: model || '你是一个简洁的中文语音助手。',
                },
              },
              sessionId,
            ),
          );
          socket.sessionId = sessionId;
          onSession?.(sessionId);
          resolve(socket);
        });
      });
    },

    sendEvent(socket, event, payload = {}) {
      sendBinary(
        socket,
        encodeJsonFrame(event, payload, socket.sessionId ?? ''),
      );
    },

    /** Stream one PCM chunk of microphone audio. */
    appendAudio(socket, pcmBytes) {
      sendBinary(
        socket,
        encodeAudioFrame(
          DOUBAO_EVENTS.taskRequest,
          pcmBytes,
          socket.sessionId ?? '',
        ),
      );
    },

    /** Ask the assistant to answer a typed question. */
    sendText(socket, text) {
      this.sendEvent(socket, DOUBAO_EVENTS.chatTextQuery, { content: text });
    },
  });
}
