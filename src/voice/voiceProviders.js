import { createRealtimeBackend } from './realtimeBackend.js';
import { createDashScopeBackend } from './dashscopeBackend.js';
import { createDoubaoBackend } from './doubaoBackend.js';
import {
  VOICE_PROVIDERS as OPTIONS,
  resolveVoiceProvider,
  readStoredVoiceProvider,
  pickVoiceProvider,
  readStoredVoiceProviderId,
} from './voiceProviderPreferences.js';
export * from './voiceProviderPreferences.js';
const ADAPTERS = {
  openai: () => createRealtimeBackend(),
  dashscope: () => createDashScopeBackend(),
  doubao: () => createDoubaoBackend(),
};
/** Runtime factories are separate from the common picker and storage policy. */
export const VOICE_PROVIDERS = Object.freeze(
  OPTIONS.map((provider) => ({
    ...provider,
    create: ADAPTERS[provider.id],
  })),
);
/**
 * Build the backend for a provider id.
 *
 * @param {string} [id] Falls back to the stored choice, then a configured
 *   provider, then the default.
 * @param {{configured?: Record<string, boolean>}} [options] Pass
 *   `probeVoiceProviders`' result so a deployment that set only one vendor's
 *   key connects with that one instead of failing on the untouched default.
 * @returns {{provider: VoiceProvider, backend: object}}
 */
export function createVoiceBackend(id, { configured } = {}) {
  const provider = id
    ? resolveVoiceProvider(id)
    : configured
      ? pickVoiceProvider({
          configured,
          storedId: readStoredVoiceProviderId(),
        })
      : readStoredVoiceProvider();
  const backend = ADAPTERS[provider.id]();
  // The controller reads `protocol` for diagnostics; keep the two in step so a
  // log line names the provider that was actually selected.
  return {
    provider,
    backend: Object.freeze({ ...backend, providerId: provider.id }),
  };
}
