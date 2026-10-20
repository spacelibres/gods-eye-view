import { sameSiteGated } from './common/same-site.js';
import { createDashScopeTokenHandler } from './dashscope/token.js';
import { DASHSCOPE_REALTIME_MODEL_DEFAULT } from './dashscope/token.js';
import { attachVoiceSocketRelay } from './voice-socket-relay.js';
import { createQwenControlHandler } from './dashscope/control.js';

/** Keep WebSocket auth headers server-side, including in browser deployments. */
export function attachDashScopeSocketRelay(server, environment = process.env) {
  const model =
    environment.DASHSCOPE_REALTIME_MODEL || DASHSCOPE_REALTIME_MODEL_DEFAULT;
  return attachVoiceSocketRelay({
    server,
    path: '/api/dashscope/socket',
    binary: false,
    upstreamUrl: `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?${new URLSearchParams({ model })}`,
    upstreamHeaders: () =>
      environment.DASHSCOPE_API_KEY
        ? {
            Authorization: `Bearer ${environment.DASHSCOPE_API_KEY}`,
            'X-DashScope-OmniRealtime': 'true',
          }
        : null,
  });
}

/**
 * Vite plugin: Alibaba Bailian realtime credential.
 *
 * The browser cannot hold the DashScope account key, so it asks this route for
 * session metadata and opens the same-origin WebSocket relay. The
 * route answers 503 naming `DASHSCOPE_API_KEY` when the server has no key,
 * which is how the picker learns the provider is not configured here.
 *
 * @param {{token?: object}} [options] `token` is passed to the handler;
 *   tests use it to inject a fetch and an environment.
 */
function dashScopeRealtimeProxy({ token = {} } = {}) {
  function install(middlewares) {
    middlewares.use(
      '/api/dashscope/vision',
      sameSiteGated(createQwenControlHandler({ visionOnly: true })),
    );
    middlewares.use(
      '/api/dashscope/token',
      sameSiteGated(createDashScopeTokenHandler(token)),
    );
  }

  return {
    name: 'dashscope-realtime-proxy',
    configureServer(server) {
      install(server.middlewares);
      if (server.httpServer) {
        const relay = attachDashScopeSocketRelay(server.httpServer);
        server.httpServer.once('close', () => relay.close());
      }
    },
    configurePreviewServer(server) {
      install(server.middlewares);
      if (server.httpServer) {
        const relay = attachDashScopeSocketRelay(server.httpServer);
        server.httpServer.once('close', () => relay.close());
      }
    },
  };
}

export { dashScopeRealtimeProxy };
