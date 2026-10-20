import { createRealtimeBackend } from './realtimeBackend.js';

/**
 * Which voice service the session talks to.
 *
 * Every entry names a backend factory with the same two-step contract the
 * OpenAI path already uses — `requestToken` then `negotiate` — so switching
 * providers never reaches into the controller, the UI or the audio graph.
 * A provider that cannot speak that contract gets its own adapter file and
 * is listed here only once that adapter exists; a name in this table is a
 * promise that selecting it connects.
 *
 * `transport` records what the adapter needs from the page. Only `webrtc`
 * providers work today: `realtimeConnection.js` builds an `RTCPeerConnection`
 * and refuses to start without one. A WebSocket provider would need that
 * branch taught a second transport, which is why it is not listed yet rather
 * than listed and broken.
 */

/**
 * @typedef {object} VoiceProvider
 * @property {string} id Stable id, stored in the settings record.
 * @property {string} label Message id for the picker.
 * @property {'webrtc'|'websocket'} transport What the page must provide.
 * @property {string} [keyEnv] Environment variable the server reads the
 *   provider's credential from, when it mints secrets server-side.
 * @property {() => Promise<object>} create Backend factory.
 */

/** @type {readonly VoiceProvider[]} */
export const VOICE_PROVIDERS = Object.freeze([
  {
    id: 'openai',
    label: 'OpenAI Realtime',
    transport: 'webrtc',
    keyEnv: 'OPENAI_API_KEY',
    create: () => createRealtimeBackend(),
  },
]);

/** The provider used when nothing else is stored, or what was stored is gone. */
export const DEFAULT_VOICE_PROVIDER = 'openai';

/** Storage key for the choice; deliberately separate from the palette's. */
export const VOICE_PROVIDER_STORAGE_KEY = 'gev.voice.provider';

/**
 * Find a provider by id.
 *
 * An unknown id resolves to null rather than throwing: a stored choice can
 * outlive the provider it names (a build that dropped one, a hand-edited
 * storage record), and the caller's job is to fall back, not to fail.
 *
 * @param {string} id
 * @returns {VoiceProvider|null}
 */
export function findVoiceProvider(id) {
  const wanted = String(id ?? '').trim();
  if (!wanted) return null;
  return VOICE_PROVIDERS.find((provider) => provider.id === wanted) ?? null;
}

/**
 * The provider to use, given a stored id.
 *
 * @param {string} [storedId]
 * @returns {VoiceProvider}
 */
export function resolveVoiceProvider(storedId) {
  return (
    findVoiceProvider(storedId) ??
    findVoiceProvider(DEFAULT_VOICE_PROVIDER) ??
    VOICE_PROVIDERS[0]
  );
}

/**
 * Read the stored provider choice.
 *
 * @param {Storage} [storage] Defaults to `localStorage`.
 * @returns {VoiceProvider}
 */
export function readStoredVoiceProvider(storage = globalThis.localStorage) {
  try {
    return resolveVoiceProvider(storage?.getItem?.(VOICE_PROVIDER_STORAGE_KEY));
  } catch {
    // Storage can throw when disabled (Safari private mode, a locked-down
    // profile); the default provider is always usable.
    return resolveVoiceProvider(null);
  }
}

/**
 * Remember the provider choice.
 *
 * @param {string} id
 * @param {Storage} [storage]
 * @returns {boolean} Whether the choice was stored.
 */
export function storeVoiceProvider(id, storage = globalThis.localStorage) {
  const provider = findVoiceProvider(id);
  if (!provider) return false;
  try {
    storage?.setItem?.(VOICE_PROVIDER_STORAGE_KEY, provider.id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the backend for a provider id.
 *
 * @param {string} [id] Falls back to the stored choice, then the default.
 * @returns {{provider: VoiceProvider, backend: object}}
 */
export function createVoiceBackend(id) {
  const provider = id ? resolveVoiceProvider(id) : readStoredVoiceProvider();
  const backend = provider.create();
  // The controller reads `protocol` for diagnostics; keep the two in step so a
  // log line names the provider that was actually selected.
  return {
    provider,
    backend: Object.freeze({ ...backend, providerId: provider.id }),
  };
}
