import { createRealtimeBackend } from './realtimeBackend.js';
import { createDashScopeBackend } from './dashscopeBackend.js';
import {
  VOICE_PROVIDER_SPECS,
  findVoiceProviderSpec,
} from './voiceProviderSpecs.js';

/**
 * Which voice service the session talks to.
 *
 * The specification of each provider — endpoints, auth fields, sample rates —
 * lives in `voiceProviderSpecs.js`. This module is the runtime side: it maps
 * those specs to backend factories and owns the stored choice.
 *
 * A provider appears in `VOICE_PROVIDERS` only when its adapter exists and the
 * page can drive it. Today `realtimeConnection.js` builds an
 * `RTCPeerConnection` and refuses to start without one, so the WebSocket
 * providers are specified but not yet selectable — listing them would put six
 * entries in the picker and five of them would connect to nothing.
 */

/** Adapters that exist. A spec with no entry here is not selectable yet. */
const ADAPTERS = {
  openai: () => createRealtimeBackend(),
  dashscope: () => createDashScopeBackend(),
};

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
export const VOICE_PROVIDERS = Object.freeze(
  VOICE_PROVIDER_SPECS.filter((spec) => ADAPTERS[spec.id]).map((spec) => ({
    id: spec.id,
    label: spec.label,
    transport: spec.transport,
    keyEnv: spec.envKeys[0],
    create: ADAPTERS[spec.id],
  })),
);

/** Providers specified but not yet wired to an adapter. */
export const PENDING_VOICE_PROVIDERS = Object.freeze(
  VOICE_PROVIDER_SPECS.filter((spec) => !ADAPTERS[spec.id]).map(
    (spec) => spec.id,
  ),
);

/** The provider used when nothing else is stored, or what was stored is gone. */
export const DEFAULT_VOICE_PROVIDER = 'openai';

/** Storage key for the choice; deliberately separate from the palette's. */
export const VOICE_PROVIDER_STORAGE_KEY = 'gev.voice.provider';

/**
 * Find a selectable provider by id.
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

/** Consumers that need the vendor's audio rates read them from the spec. */
export { findVoiceProviderSpec };
