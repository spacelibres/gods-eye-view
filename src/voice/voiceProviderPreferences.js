import {
  VOICE_PROVIDER_SPECS,
  findVoiceProviderSpec,
} from './voiceProviderSpecs.js';

/**
 * Which voice service the session talks to.
 *
 * The specification of each provider — endpoints, auth fields, sample rates —
 * lives in `voiceProviderSpecs.js`. This module owns selection and storage
 * without importing a protocol adapter. Runtime factories live in
 * `voiceProviders.js`; common controls only need these metadata records.
 */

const IMPLEMENTED = ['openai', 'dashscope', 'doubao'];

/**
 * @typedef {object} VoiceProvider
 * @property {string} id Stable id, stored in the settings record.
 * @property {string} label Message id for the picker.
 * @property {'webrtc'|'websocket'} transport What the page must provide.
 * @property {string} [keyEnv] Environment variable the server reads the
 *   provider's credential from, when it mints secrets server-side.
 */

/** @type {readonly VoiceProvider[]} */
export const VOICE_PROVIDERS = Object.freeze(
  VOICE_PROVIDER_SPECS.filter((spec) => IMPLEMENTED.includes(spec.id)).map(
    (spec) => ({
      id: spec.id,
      label: spec.label,
      transport: spec.transport,
      keyEnv: spec.envKeys[0],
    }),
  ),
);

/** Providers specified but not yet wired to an adapter. */
export const PENDING_VOICE_PROVIDERS = Object.freeze(
  VOICE_PROVIDER_SPECS.filter((spec) => !IMPLEMENTED.includes(spec.id)).map(
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
 * Read the stored provider id without resolving it, so the caller can tell
 * "nothing stored" from "stored the default".
 */
export function readStoredVoiceProviderId(storage = globalThis.localStorage) {
  try {
    return storage?.getItem?.(VOICE_PROVIDER_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/**
 * Rank providers by whether this deployment can actually run them.
 *
 * The stored choice wins when it is usable. When it is not — the common case
 * on a deployment that set only one vendor's key — the first configured
 * provider is used instead of surfacing "OPENAI_API_KEY is not set" for a
 * service the user never chose.
 *
 * @param {{configured: Record<string, boolean>, storedId?: string}}
 *   options `configured[id]` is true when that provider answered its
 *   credential probe.
 * @returns {VoiceProvider} Always a provider; the stored one, then a ready
 *   one, then the default.
 */
export function pickVoiceProvider({ configured = {}, storedId } = {}) {
  const stored = findVoiceProvider(storedId);
  if (stored && configured[stored.id] !== false) return stored;
  const ready = VOICE_PROVIDERS.find((provider) => configured[provider.id]);
  return ready ?? stored ?? resolveVoiceProvider(null);
}

/**
 * Ask each provider's server route whether it holds a credential.
 *
 * Only the providers that ship a probe are checked; a provider without one is
 * treated as usable so the check can never hide a working option.
 *
 * @param {((id: string) => Promise<boolean>)|null} [probe]
 * @returns {Promise<Record<string, boolean>>}
 */
export async function probeVoiceProviders(probe) {
  const results = {};
  await Promise.all(
    VOICE_PROVIDERS.map(async (provider) => {
      if (typeof probe !== 'function') return;
      try {
        results[provider.id] = await probe(provider.id);
      } catch {
        results[provider.id] = false;
      }
    }),
  );
  return results;
}

/** Consumers that need the vendor's audio rates read them from the spec. */
export { findVoiceProviderSpec };
