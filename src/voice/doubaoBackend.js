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
 *   byte 1  message type(4) | flags(4)                 0x14 = full client JSON
 *   byte 2  serialization(4) | compression(4)          0x10 = JSON, 0 = none
 *   byte 3  reserved                                    0x00
 *   u32     event id
 *   ...     event-specific body
 *
 * Two rules that cost the most time:
 *
 * - The body is **never gzipped**. The public examples gzip it; this service
 *   answers `invalid char \x1f\x8b` and closes.
 * - The connection frame's payload must be real JSON. An empty `{}` is refused
 *   with `unexpected end of JSON input`.
 */

/** The realtime dialogue endpoint. */
const DEFAULT_SOCKET_URL =
  'wss://openspeech.bytedance.com/api/v3/realtime/dialogue';

/** Event ids, as the service numbers them. */
export const DOUBAO_EVENTS = Object.freeze({
  startConnection: 1,
  startSession: 100,
  finishSession: 102,
  taskRequest: 200,
  sayHello: 300,
  chatTextQuery: 501,
  chatTTSText: 500,
  connectionStarted: 50,
  connectionFailed: 51,
  sessionStarted: 150,
  sessionFailed: 153,
  sessionFinished: 152,
  ttsSentenceStart: 350,
  ttsResponse: 352,
  ttsSentenceEnd: 351,
  ttsEnded: 359,
  asrInfo: 450,
  asrResponse: 451,
  asrEnded: 459,
  chatResponse: 550,
  chatEnded: 559,
  subvTitle: 553,
});

/** Message types in the header's high nibble of byte 1. */
const MSG = Object.freeze({
  fullClient: 0x1,
  audioOnly: 0x2,
  ack: 0xb,
  error: 0xf,
});

/** Header bytes for a JSON client frame. */
const JSON_HEADER = Object.freeze([0x11, 0x14, 0x10, 0x00]);
/** Header bytes for a raw audio client frame. */
const AUDIO_HEADER = Object.freeze([0x11, 0x20, 0x00, 0x00]);

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

/**
 * A full client request carrying JSON.
 *
 * @param {number} event
 * @param {object} payload
 * @param {string} [sessionId] Present on everything after StartSession.
 */
export function encodeJsonFrame(event, payload, sessionId = '') {
  const body = Buffer.from(JSON.stringify(payload));
  const parts = [Buffer.from(JSON_HEADER), u32(event)];
  if (sessionId) {
    const id = Buffer.from(sessionId);
    parts.push(u32(id.length), id);
  }
  parts.push(u32(body.length), body);
  return Buffer.concat(parts);
}

/**
 * A client audio frame.
 *
 * `event` 200 is the task request this service expects for streamed audio.
 */
export function encodeAudioFrame(event, pcm, sessionId = '') {
  const parts = [Buffer.from(AUDIO_HEADER), u32(event)];
  if (sessionId) {
    const id = Buffer.from(sessionId);
    parts.push(u32(id.length), id);
  }
  parts.push(u32(pcm.length), pcm);
  return Buffer.concat(parts);
}

/** True for the UUID shape the service uses for session ids. */
function isSessionId(bytes) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    bytes.toString(),
  );
}

/**
 * Parse one server frame.
 *
 * Server frames come in two shapes. Text events carry `event + sessionId +
 * json`; audio events carry `event + sessionId + pcm`. The declared length is
 * what distinguishes them, so the reader trusts the frame rather than a table.
 *
 * @param {Buffer} bytes
 * @returns {{type: number, flags: number, event: number| null,
 *   sessionId: string, json: object|null, audio: Buffer|null, error: string|null}}
 */
export function decodeServerFrame(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const type = buffer[1] >> 4;
  const flags = buffer[1] & 0x0f;
  const frame = {
    type,
    flags,
    event: null,
    sessionId: '',
    json: null,
    audio: null,
    error: null,
  };
  if (type === MSG.error) {
    // Error frames put the message straight after the header.
    frame.error = buffer.subarray(8).toString('utf8').replace(/^\0+/, '');
    return frame;
  }
  if (buffer.length < 8) return frame;
  frame.event = buffer.readUInt32BE(4);
  let offset = 8;
  // A session id is a UUID, and every text event after StartSession carries
  // one. The length field alone cannot tell it apart from a short payload —
  // a two-byte `{}` body reads as a two-byte id — so the shape is checked
  // too. Connection-level frames have none.
  if (buffer.length >= offset + 4) {
    const idLength = buffer.readUInt32BE(offset);
    if (
      idLength === 36 &&
      buffer.length >= offset + 4 + idLength &&
      isSessionId(buffer.subarray(offset + 4, offset + 4 + idLength))
    ) {
      frame.sessionId = buffer
        .subarray(offset + 4, offset + 4 + idLength)
        .toString();
      offset += 4 + idLength;
    }
  }
  if (buffer.length < offset + 4) return frame;
  const payloadLength = buffer.readUInt32BE(offset);
  offset += 4;
  const body = buffer.subarray(offset, offset + payloadLength);
  if (frame.event === DOUBAO_EVENTS.ttsResponse) {
    // Audio: the body is PCM16, no JSON wrapper.
    frame.audio = body;
    return frame;
  }
  const text = body.toString('utf8');
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
 * @returns {{type: string, delta?: string, text?: string} | null}
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
 * Create the Doubao backend.
 *
 * Unlike DashScope, this service authenticates the socket with the account's
 * App ID and access token rather than a minted credential, so `requestToken`
 * asks this app's server for the pair and `openSocket` sends it in the headers.
 *
 * @param {{tokenEndpoint?: string, socketUrl?: string, resourceId?: string,
 *   appKey?: string, tokenTransport?: Function, WebSocketImpl?: Function,
 *   timeoutMs?: number, signal?: AbortSignal}} [options]
 */
export function createDoubaoBackend({
  tokenEndpoint = '/api/doubao/token',
  socketUrl = DEFAULT_SOCKET_URL,
  resourceId = 'volc.speech.dialog',
  appKey = 'PlgvMymc7f3tQnJ6',
  tokenTransport = (...args) => fetch(...args),
  WebSocketImpl = (...args) => new WebSocket(...args),
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
    // Doubao's own event vocabulary; the shared handler translates by `type`
    // so sessions look the same to the UI.
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
    openSocket({ credential, model, signal, onSession }) {
      signal = scoped(signal);
      signal.throwIfAborted();
      const socket = WebSocketImpl(socketUrl, {
        headers: {
          'X-Api-App-ID': credential.appId,
          'X-Api-Access-Key': credential.token,
          'X-Api-Resource-Id': resourceId,
          'X-Api-App-Key': appKey,
          'X-Api-Connect-Id': newSessionId(),
        },
      });
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
          socket.send(
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
          socket.send(
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
      socket.send(encodeJsonFrame(event, payload, socket.sessionId ?? ''));
    },

    /** Stream one PCM chunk of microphone audio. */
    appendAudio(socket, pcmBytes) {
      socket.send(
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
