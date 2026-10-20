#!/usr/bin/env node
/**
 * Serve the production build, with the app's own API routes.
 *
 * `vite preview` serves `dist/` as static files only: it never runs the
 * provider plugins that register `/api/*`, because those live in
 * `configurePreviewServer`, which the CLI does not load. A deployment that ran
 * `vite preview` therefore answered every API route with the app's own 404 and
 * the map fell back to whatever the browser could fetch directly.
 *
 * This server is the missing half:
 *
 *   - it serves `dist/` the way preview did (index fallback, no directory
 *     listing, a long cache for hashed assets, no cache for the shell);
 *   - it mounts the same provider plugins the dev server mounts, through a
 *     minimal `server.middlewares.use(path, handler)` bridge, so the routes are
 *     the ones the tests already cover rather than a second implementation;
 *   - it answers unknown `/api/*` with JSON, exactly like the dev server.
 *
 * Configuration is the same environment the installer already writes:
 * HOST/PORT, GEV_ALLOWED_HOSTS (Host check), GEV_TRUSTED_PROXY (set behind
 * Caddy), and whatever provider credentials live in /etc/gods-eye-view.env.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { localProviderPlugins } from '../providers/local.js';
import { attachVoiceSocketRelay } from '../providers/voice-socket-relay.js';
import { apiNotFoundPlugin } from './api-not-found.js';
import {
  isAllowedHost,
  resolveAllowedHosts,
} from '../../build/allowedHosts.js';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DIST = path.join(ROOT, 'dist');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);
const ALLOWED_HOSTS = resolveAllowedHosts(process.env.GEV_ALLOWED_HOSTS);

/** Content types for what a built app actually ships. */
const TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.b3dm': 'application/octet-stream',
  '.pbf': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
};

/**
 * The provider plugins, in the order the dev server mounts them. The API 404
 * stays last so it only answers what nothing else claimed.
 */
const plugins = [
  ...localProviderPlugins({ realtime: {} }),
  apiNotFoundPlugin(),
];

/**
 * A connect-compatible registry. Vite hands plugins a `server` whose
 * `middlewares.use(path?, handler)` mounts a route; this reproduces exactly
 * that shape so the plugins need no changes.
 */
function createRouter() {
  /** @type {{prefix: string|null, handler: Function}[]} */
  const routes = [];
  return {
    middlewares: {
      use(prefixOrHandler, maybeHandler) {
        const hasPrefix = typeof prefixOrHandler === 'string';
        routes.push({
          prefix: hasPrefix ? prefixOrHandler.replace(/\/+$/, '') : null,
          handler: hasPrefix ? maybeHandler : prefixOrHandler,
        });
      },
    },
    /**
     * Run the first matching route. A prefix match keeps the full URL, because
     * the plugins parse `req.url` themselves (and expect the mount in it).
     * Returns true when a route matched, whether or not its response has
     * finished yet.
     */
    async dispatch(req, res) {
      const pathname = (req.url || '/').split('?')[0];
      for (const { prefix, handler } of routes) {
        if (
          prefix &&
          pathname !== prefix &&
          !pathname.startsWith(`${prefix}/`)
        ) {
          continue;
        }
        // A handler may decline by calling `next()`, in which case the next
        // matching route gets the request. Passing an inert stub here left
        // such a request open forever: the handler returned without answering
        // and nothing else ran.
        //
        // The mount is stripped before the handler runs, which is what Vite's
        // middleware does and what the plugins assume: the flights route only
        // answers when the remaining path is `/`, the local-receivers route
        // compares the remainder with its own mount, and the tile relay
        // strips the prefix it was given. Passing the full URL made all three
        // decline, and every layer answered 404 or `invalid group`.
        const originalUrl = req.url;
        if (prefix) {
          const rest = String(originalUrl || '').slice(prefix.length);
          req.url = rest.startsWith('?') ? `/${rest}` : rest || '/';
        }
        let declined = false;
        let release;
        const declinedPromise = new Promise((resolve) => {
          release = resolve;
        });
        const next = (error) => {
          if (error && !res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: error.message ?? 'Route failed' }));
          } else {
            declined = true;
          }
          release();
        };
        try {
          const result = handler(req, res, next);
          // A response that streams finishes after the handler returns, so a
          // handler that answered is not awaited further; one that declined
          // is, so the next route can run.
          if (result && typeof result.then === 'function') {
            await Promise.race([result, declinedPromise]);
          }
        } catch (error) {
          req.url = originalUrl;
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({ error: error?.message ?? 'Route failed' }),
            );
          }
          return true;
        }
        req.url = originalUrl;
        if (declined && !res.headersSent && !res.writableEnded) continue;
        return true;
      }
      return false;
    },
  };
}

const router = createRouter();
for (const plugin of plugins) {
  // `configureServer` is the shape every plugin implements; `vite preview`
  // only ever loaded `configurePreviewServer`, which is why the key-setup
  // routes were missing from the deployed build as well.
  (plugin.configureServer ?? plugin.configurePreviewServer)?.({
    middlewares: router.middlewares,
  });
}

/** Resolve a URL path inside `dist`, refusing anything that escapes it. */
function resolveFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const target = path.join(DIST, path.normalize(decoded));
  if (!target.startsWith(DIST)) return null;
  try {
    return statSync(target).isFile() ? target : null;
  } catch {
    return null;
  }
}

/** Cache policy: hashed assets are immutable, the shell must revalidate. */
function cacheControl(file) {
  const relative = path.relative(DIST, file);
  return relative.startsWith('assets/')
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
}

function sendFile(req, res, file) {
  res.statusCode = 200;
  res.setHeader(
    'Content-Type',
    TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
  );
  res.setHeader('Cache-Control', cacheControl(file));
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  // The same Host check the dev server applies: a DNS-rebinding name must not
  // reach the app. Caddy passes the public name through, unchanged.
  if (!isAllowedHost(req.headers.host, ALLOWED_HOSTS)) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Blocked request.');
    return;
  }

  if (await router.dispatch(req, res)) return;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.end();
    return;
  }

  const pathname = (req.url || '/').split('?')[0];
  // An unmatched API path is a route error, not a page to fall back to.
  if (pathname.startsWith('/api/')) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: 'Unknown API route' }));
    return;
  }

  const file = resolveFile(pathname);
  if (file && !file.endsWith('/index.html')) {
    sendFile(req, res, file);
    return;
  }
  // A missing file under /assets/ is a version skew, not a route: an older tab
  // asks for the asset names of the release it loaded. Answering with the app
  // shell would hand a script request an HTML document, which fails in a way
  // that looks like a corrupt build. A 404 says what happened.
  if (pathname.startsWith('/assets/')) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'HEAD') {
      res.end(
        `Unknown asset for this release: ${pathname}\nReload the page.\n`,
      );
    } else {
      res.end();
    }
    return;
  }
  // The app is a single page: unknown paths and `/` both get the shell.
  sendFile(req, res, path.join(DIST, 'index.html'));
});

// The browser cannot put headers on a WebSocket, and Volcengine signs its
// socket with `X-Api-*` headers. This same-origin relay is that missing hop.
// Without a credential it refuses before upgrading, which the page reports as
// a failed connect rather than a silent session.
const voiceSocketRelay = attachVoiceSocketRelay({
  server,
  upstreamUrl: 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue',
  upstreamHeaders: () => {
    const appId = String(process.env.DOUBAO_APP_ID || '').trim();
    const accessToken = String(process.env.DOUBAO_ACCESS_TOKEN || '').trim();
    if (!appId || !accessToken) return null;
    return {
      'X-Api-App-ID': appId,
      'X-Api-Access-Key': accessToken,
      'X-Api-Resource-Id': 'volc.speech.dialog',
      'X-Api-App-Key': 'PlgvMymc7f3tQnJ6',
      'X-Api-Connect-Id': globalThis.crypto.randomUUID(),
    };
  },
});
server.on('close', () => voiceSocketRelay.close());

server.listen(PORT, HOST, () => {
  console.log(`[serve] ${ROOT} on http://${HOST}:${PORT}`);
  console.log(
    `[serve] API routes from ${plugins.length} plugin(s); allowed hosts: ${ALLOWED_HOSTS.join(', ')}`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
