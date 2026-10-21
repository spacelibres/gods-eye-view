import { createVoiceCommands as bindVoiceCommands } from './sessionCommands.js';
import { createRealtimeSession } from './realtimeSession.js';
import { createGeminiSession } from './geminiSession.js';
import { createProviderCommands } from './providerCommands.js';
import { createVoiceBackend } from './voiceProviders.js';
import { probeVoiceProvidersCached } from './voiceProviderProbe.js';

const realtimeProvider = (id) => (options) =>
  createRealtimeSession({
    ...options,
    backend: options.backend ?? createVoiceBackend(id).backend,
  });

/** Default composition; callers may supply another session adapter factory. */
export function createVoiceCommands(options = {}) {
  // Generic hosts retain the existing default; standalone opts in explicitly.
  if (!options.createSession && options.supportedProviders !== undefined)
    return createProviderCommands(options, {
      bind: bindVoiceCommands,
      probeProviders: probeVoiceProvidersCached,
      factories: {
        openai: realtimeProvider('openai'),
        gemini: createGeminiSession,
        dashscope: realtimeProvider('dashscope'),
        doubao: realtimeProvider('doubao'),
      },
    });
  return bindVoiceCommands({
    createSession: createRealtimeSession,
    ...options,
  });
}
