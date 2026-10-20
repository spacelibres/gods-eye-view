/**
 * Google's 3D tiles, fetched by this server on the browser's behalf.
 *
 * A browser whose network cannot reach `tile.googleapis.com` probes it, fails,
 * and then asks this route instead:
 *
 *   GET /api/google/tiles/v1/3dtiles/root.json?key=…
 *   GET /api/google/tiles/<session>/<version>/…     (the tileset's own paths)
 *
 * The server drops the browser's placeholder key, asks Google with its own, and
 * streams the answer back. `Content-Encoding` is not forwarded because `fetch`
 * already decoded the body.
 *
 * With no server key the route answers 404 before touching the upstream, which
 * is how the client learns there is nothing to fall back to.
 */
import { Readable } from 'node:stream';
import { admitSameSite } from './common/same-site.js';

/** Same-origin mount; the rest of the path is Google's. */
export const GOOGLE_TILES_PATH = '/api/google/tiles';

/** Google's host. */
export const GOOGLE_TILES_UPSTREAM = 'https://tile.googleapis.com/';

/**
 * Referrer sent with every relayed request.
 *
 * The API key is referrer-restricted to this origin, so a server-side request
 * that presents another referrer (or none, for the tile endpoints) is refused
 * with 403. Google's own Cesium integration loads the same asset from this
 * origin, which is why it is the one that works.
 */
export const GOOGLE_TILES_REFERER = 'https://ion.cesium.com/';

const MAX_REDIRECTS = 5;

const FORWARDED_HEADERS = Object.freeze([
  'content-type',
  'content-length',
  'etag',
  'last-modified',
]);

/**
 * True for a request to the mount itself — the client's reachability probe.
 *
 * The middleware strips the mount before the handler runs, so a probe arrives
 * as `/`, `''` or `?…`; a real tile request always has a path after the mount.
 *
 * @param {string} requestUrl The URL as the handler sees it.
 * @param {string} mount The relay mount, accepted for callers that pass the
 *   un-stripped form too.
 * @returns {boolean}
 */
export function isMountRoot(requestUrl, mount = GOOGLE_TILES_PATH) {
  const path = String(requestUrl || '')
    .split('?')[0]
    .replace(/\/+$/, '');
  return path === '' || path === mount;
}

/** Strip the mount, keep Google's leading slash. */
export function upstreamPath(requestPath, mount = GOOGLE_TILES_PATH) {
  const pathname = String(requestPath || '');
  // Connect-style mounts strip the prefix before calling the handler, so a
  // request to the mount itself arrives as '' or '/'. Google's root lives at
  // /v1/3dtiles/root.json, which the client asks for explicitly; a bare mount
  // is only ever the client's probe, answered before reaching here.
  if (pathname === '' || pathname === '/') return '/';
  const index = pathname.indexOf(mount);
  const rest = index < 0 ? pathname : pathname.slice(index + mount.length);
  return rest.startsWith('/') ? rest : `/${rest}`;
}

/**
 * @param {{apiKey?: () => string, fetchImpl?: Function, path?: string,
 *   upstream?: string, toNodeStream?: Function}} [options] `toNodeStream`
 *   turns the upstream web stream into a Node stream; injectable so the
 *   handler can run against a plain response object in tests.
 */
export function googleTilesRelay({
  apiKey = () => '',
  fetchImpl = (...args) => fetch(...args),
  path = GOOGLE_TILES_PATH,
  upstream = GOOGLE_TILES_UPSTREAM,
  toNodeStream = (body) => Readable.fromWeb(body),
} = {}) {
  function install(middlewares) {
    middlewares.use(path, async (req, res) => {
      if (admitSameSite(req, res)) return;
      const key = String(apiKey() ?? '').trim();
      if (!key) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(
          JSON.stringify({ error: 'Google tile relay is not configured' }),
        );
        return;
      }
      if (req.method === 'HEAD' || isMountRoot(req.url, path)) {
        // The client's reachability probe: it asks for the mount itself, with
        // no Google path after it, and only needs to know the relay exists.
        // This must answer for GET too — the probe uses GET, because HEAD is
        // not reliable through every proxy — otherwise the empty path would be
        // forwarded to Google's root, which answers with its own 404 page.
        res.statusCode = 200;
        res.setHeader('Cache-Control', 'no-store');
        res.end();
        return;
      }
      if (req.method !== 'GET') {
        res.statusCode = 405;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      const target = new URL(upstreamPath(req.url, path), upstream);
      // The browser sends a placeholder; the server's key replaces it.
      target.searchParams.set('key', key);

      try {
        const response = await follow(fetchImpl, target.toString());
        res.statusCode = response.status;
        for (const header of FORWARDED_HEADERS) {
          // `content-length` is recomputed for a rewritten body below.
          if (header === 'content-length') continue;
          const value = response.headers.get(header);
          if (value) res.setHeader(header, value);
        }
        // Private to this browser session: Cesium may reuse a tile, a shared
        // cache may not hold licensed imagery.
        res.setHeader('Cache-Control', 'private, max-age=300');
        if (!response.body) {
          res.end();
          return;
        }
        // JSON tile-set documents name their children with root-relative URIs
        // (`/v1/3dtiles/…`). Resolved against this mount that drops the relay
        // prefix and asks the app root — a path nothing serves — so the child
        // requests must be rewritten to stay under the mount.
        const type = String(response.headers.get('content-type') || '');
        if (type.includes('json')) {
          const text = await response.text();
          const body = rewriteDocumentUris(text, path);
          // The rewrite changes the length; the upstream `Content-Length` would
          // otherwise truncate the body at the old size.
          res.setHeader('Content-Length', String(Buffer.byteLength(body)));
          res.end(body);
          return;
        }
        toNodeStream(response.body).pipe(res);
      } catch (error) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(
          JSON.stringify({
            error: `Google tile relay failed: ${error.message}`,
          }),
        );
      }
    });
  }

  return {
    name: 'google-tiles-relay',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

/**
 * Keep a tile-set document's child URIs under the relay mount.
 *
 * Google answers with root-relative URIs (`/v1/3dtiles/datasets/…`). A client
 * resolves those against the document's URL, and a leading `/` discards the
 * path it was fetched from — so every child request would ask the app root
 * instead of `/api/google/tiles/…`. Prefixing the mount keeps them here.
 *
 * @param {string} text The JSON document body.
 * @param {string} mount The relay mount, e.g. `/api/google/tiles`.
 * @returns {string} The body, with `uri` values made relay-relative.
 */
export function rewriteDocumentUris(text, mount) {
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    return text;
  }
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node.uri === 'string' && node.uri.startsWith('/')) {
      if (!node.uri.startsWith(`${mount}/`)) node.uri = `${mount}${node.uri}`;
    }
    for (const value of Object.values(node)) visit(value);
  };
  visit(document);
  return JSON.stringify(document);
}

async function follow(fetchImpl, url) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetchImpl(current, {
      redirect: 'manual',
      headers: {
        // The key is referrer-restricted; without this Google answers 403.
        Referer: GOOGLE_TILES_REFERER,
        Origin: GOOGLE_TILES_REFERER.slice(0, -1),
      },
    });
    const location = response.headers.get('location');
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) {
      return response;
    }
    current = new URL(location, current).toString();
  }
  throw new Error('too many redirects');
}
