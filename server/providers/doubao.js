import { sameSiteGated } from './common/same-site.js';
import { createDoubaoTokenHandler } from './doubao/token.js';

/**
 * Vite plugin: Volcengine Doubao realtime credential.
 *
 * Sibling of the DashScope plugin. This vendor's socket authenticates with the
 * account's App ID and access token rather than a minted secret, so the route
 * hands those to the caller's own session — still server-side, still gated by
 * the same-site check, and still a 503 that names the variable when the
 * deployment has none.
 */
function doubaoRealtimeProxy({ token = {} } = {}) {
  function install(middlewares) {
    middlewares.use(
      '/api/doubao/token',
      sameSiteGated(createDoubaoTokenHandler(token)),
    );
  }

  return {
    name: 'doubao-realtime-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

export { doubaoRealtimeProxy };
