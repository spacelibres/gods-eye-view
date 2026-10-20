import { sameSiteGated } from './common/same-site.js';
import { createDoubaoTokenHandler } from './doubao/token.js';
import { createQwenControlHandler } from './dashscope/control.js';
import { attachVoiceSocketRelay } from './voice-socket-relay.js';

/** Attach the binary voice relay in dev, preview and standalone servers. */
export function attachDoubaoSocketRelay(server, environment = process.env) {
  return attachVoiceSocketRelay({
    server,
    upstreamHeaders: () => {
      const appId = String(environment.DOUBAO_APP_ID || '').trim();
      const accessToken = String(environment.DOUBAO_ACCESS_TOKEN || '').trim();
      return appId && accessToken
        ? {
            'X-Api-App-ID': appId,
            'X-Api-Access-Key': accessToken,
            'X-Api-Resource-Id': 'volc.speech.dialog',
            'X-Api-App-Key': 'PlgvMymc7f3tQnJ6',
            'X-Api-Connect-Id': globalThis.crypto.randomUUID(),
          }
        : null;
    },
  });
}

/**
 * Vite plugin: Volcengine Doubao realtime credential.
 *
 * The route reports relay availability without returning account credentials.
 * Qwen tool decisions share the same-site gate and the existing app tool catalog.
 */
function doubaoRealtimeProxy({ token = {}, tools } = {}) {
  function install(middlewares) {
    middlewares.use(
      '/api/doubao/control',
      sameSiteGated(createQwenControlHandler({ tools })),
    );
    middlewares.use(
      '/api/doubao/token',
      sameSiteGated(createDoubaoTokenHandler(token)),
    );
  }

  return {
    name: 'doubao-realtime-proxy',
    configureServer(server) {
      install(server.middlewares);
      if (server.httpServer) {
        const relay = attachDoubaoSocketRelay(server.httpServer);
        server.httpServer.once('close', () => relay.close());
      }
    },
    configurePreviewServer(server) {
      install(server.middlewares);
      if (server.httpServer) {
        const relay = attachDoubaoSocketRelay(server.httpServer);
        server.httpServer.once('close', () => relay.close());
      }
    },
  };
}

export { doubaoRealtimeProxy };
