import { DEFAULT_VOICE_TIER, resolveVoiceModel } from './voiceCost.js';

/** DashScope's realtime socket. The model is chosen per connection. */
const DEFAULT_SOCKET_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';

/**
 * Default realtime model.
 *
 * Verified against the live service: `qwen3-omni-flash-realtime` accepts the
 * connection and answers `session.created`, then rejects every event with
 * `1007 Model not exist.` — a misleading message for an alias the service no
 * longer routes. The dated `qwen3.5-omni-plus-realtime` and
 * `qwen3.8-omni-flash-realtime` accept `session.update` and run a session, so
 * one of those is used here. `DASHSCOPE_REALTIME_MODEL` overrides it.
 *
 * `qwen3-s2s-flash-realtime-*` is not a candidate: it is the live-translation
 * model, and it rejects a session that carries no `translation.language`.
 */
const DEFAULT_MODEL = 'qwen3.8-omni-flash-realtime';

/**
 * Alibaba Bailian (Qwen Omni) realtime backend.
 *
 * It speaks the OpenAI realtime *event vocabulary* — `session.update`,
 * `input_audio_buffer.append`, `response.audio.delta` — but over a plain
 * WebSocket instead of WebRTC. Verified against the live service: opening
 * `wss://…/api-ws/v1/realtime?model=…` with a minted token answers
 * `session.created` with the same field names.
 *
 * The backend contract is the same two steps the OpenAI adapter exposes, so
 * the controller does not branch on provider:
 *
 * - `requestToken` asks this app's server for a short-lived DashScope token.
 * - `openSocket` gives the caller a socket plus the small protocol helpers a
 *   WebSocket session needs. `negotiate` (SDP) is absent by design: there is
 *   no SDP in this transport, and a caller reaching for it is a bug.
 *
 * @param {{tokenEndpoint?: string, socketUrl?: string, model?: string,
 *   tokenTransport?: Function, WebSocketImpl?: Function,
 *   timeoutMs?: number, signal?: AbortSignal}} [options]
 */
export function createDashScopeBackend({
  tokenEndpoint = '/api/dashscope/token',
  socketUrl = DEFAULT_SOCKET_URL,
  model = DEFAULT_MODEL,
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
    protocol: 'dashscope-realtime',
    transport: 'websocket',
    audio: { inputHz: 16_000, outputHz: 24_000 },

    /** Mint a short-lived token. The account key stays on the server. */
    async requestToken({ tier = DEFAULT_VOICE_TIER, signal } = {}) {
      signal = scoped(signal);
      signal.throwIfAborted();
      const separator = tokenEndpoint.includes('?') ? '&' : '?';
      const url = `${tokenEndpoint}${separator}${new URLSearchParams({
        tier: resolveVoiceModel(tier).tier,
      })}`;
      const response = await tokenTransport(url, {
        signal,
        cache: 'no-store',
        redirect: 'error',
      });
      signal.throwIfAborted();
      const data = await response.json().catch(() => null);
      signal.throwIfAborted();
      if (!response.ok) {
        const reason =
          typeof data?.error === 'string' ? data.error : data?.error?.message;
        throw new Error(
          reason || `DashScope token failed: HTTP ${response.status}`,
        );
      }
      const token = data?.value;
      if (typeof token !== 'string' || !token)
        throw new Error('DashScope token response did not include a token');
      const expiresAt = data?.expires_at ?? null;
      if (
        expiresAt != null &&
        (!Number.isFinite(expiresAt) || expiresAt * 1000 <= Date.now())
      )
        throw new Error(
          'DashScope token has expired; reconnect to request a new one',
        );
      return {
        token,
        model:
          response.headers?.get?.('X-GEV-Voice-Model') ||
          data?.session?.model ||
          model,
        tier: response.headers?.get?.('X-GEV-Voice-Tier') || null,
        transcribeModel: null,
        expiresAt,
      };
    },

    /**
     * Open the realtime socket.
     *
     * The token goes in the `Authorization` header, not the query string, so it
     * stays out of proxy logs and the page history.
     *
     * @param {{credential: {token: string}, model?: string,
     *   signal?: AbortSignal}} options
     * @returns {Promise<WebSocket>} Resolves once the socket is open; rejects
     *   if it errors first, so a dead key surfaces as a failed connect rather
     *   than a session that never answers.
     */
    openSocket({ credential, model: requestedModel = model, signal }) {
      signal = scoped(signal);
      signal.throwIfAborted();
      const url = `${socketUrl}?${new URLSearchParams({
        model: requestedModel,
      })}`;
      const socket = WebSocketImpl(url, {
        headers: { Authorization: `Bearer ${credential.token}` },
      });
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          cleanup();
          try {
            socket.close();
          } catch {
            // Closing an unopened socket is not an error worth reporting.
          }
          reject(new Error('DashScope socket aborted'));
        };
        const cleanup = () => {
          signal?.removeEventListener?.('abort', onAbort);
          socket.removeEventListener?.('open', onOpen);
          socket.removeEventListener?.('error', onError);
        };
        const onOpen = () => {
          cleanup();
          resolve(socket);
        };
        const onError = () => {
          cleanup();
          reject(new Error('DashScope socket failed to open'));
        };
        signal?.addEventListener?.('abort', onAbort, { once: true });
        socket.addEventListener('open', onOpen);
        socket.addEventListener('error', onError);
      });
    },

    /** Send one realtime event; the vocabulary is the vendor's own. */
    sendEvent(socket, event) {
      socket.send(JSON.stringify({ event_id: newEventId(), ...event }));
    },

    /** Append one base64 PCM chunk of microphone audio. */
    appendAudio(socket, base64Pcm) {
      this.sendEvent(socket, {
        type: 'input_audio_buffer.append',
        audio: base64Pcm,
      });
    },
  });
}

let eventCounter = 0;

/** Event ids only need to be unique within a session. */
function newEventId() {
  eventCounter += 1;
  return `event_${Date.now().toString(36)}_${eventCounter.toString(36)}`;
}
