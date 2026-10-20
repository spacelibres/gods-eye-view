import { sameSiteGated } from './common/same-site.js';
import { createDashScopeTokenHandler } from './dashscope/token.js';

/**
 * Vite plugin: Alibaba Bailian realtime credential.
 *
 * The browser cannot hold the DashScope account key, so it asks this route for
 * a short-lived token instead and opens the vendor's WebSocket with it. The
 * route answers 503 naming `DASHSCOPE_API_KEY` when the server has no key,
 * which is how the picker learns the provider is not configured here.
 *
 * @param {{token?: object}} [options] `token` is passed to the handler;
 *   tests use it to inject a fetch and an environment.
 */
function dashScopeRealtimeProxy({ token = {} } = {}) {
  function install(middlewares) {
    middlewares.use(
      '/api/dashscope/token',
      sameSiteGated(createDashScopeTokenHandler(token)),
    );
  }

  return {
    name: 'dashscope-realtime-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

export { dashScopeRealtimeProxy };
