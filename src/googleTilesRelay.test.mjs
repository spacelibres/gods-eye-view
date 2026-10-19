import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GOOGLE_TILES_PATH,
  googleTilesRelay,
  rewriteDocumentUris,
  upstreamPath,
} from '../server/providers/google-tiles-relay.js';
import {
  TILES_RELAY_PATH,
  chooseTileRoute,
  relayGoogleTiles,
  restoreDirectTiles,
} from './maps/tileRoute.js';

/* ── the client's probe ───────────────────────────────────────────── */

test('a reachable Google keeps the session direct', async () => {
  const asked = [];
  const route = await chooseTileRoute({
    apiKey: 'real-key',
    fetchImpl: async (url) => {
      asked.push(url);
      return new Response('{"asset":{}}', { status: 200 });
    },
  });
  assert.equal(route, 'direct');
  // The probe carries the key the tiles will use; without one a 200 is
  // meaningless (Google answers an invalid key with 400).
  assert.equal(asked.length, 1);
  assert.match(asked[0], /tile\.googleapis\.com.*[?&]key=real-key/);
});

test('a local proxy answering 400 is not a path to Google', async () => {
  // The reported failure: a browser behind a localhost-only proxy shows
  // "400 Bad Request" from 127.0.0.1 and never reaches Google.
  const route = await chooseTileRoute({
    apiKey: 'real-key',
    fetchImpl: async (url) => {
      if (url.includes('tile.googleapis.com')) {
        return new Response('Bad Request', { status: 400 });
      }
      return new Response(null, { status: 200 });
    },
  });
  assert.equal(route, 'relayed');
});

test('an unreachable Google falls back to the relay when it exists', async () => {
  const route = await chooseTileRoute({
    apiKey: 'real-key',
    fetchImpl: async (url) => {
      if (url.includes('tile.googleapis.com')) throw new Error('offline');
      return new Response(null, { status: 200 });
    },
  });
  assert.equal(route, 'relayed');
});

test('an unreachable Google with no relay stays direct', async () => {
  const route = await chooseTileRoute({
    apiKey: 'real-key',
    fetchImpl: async (url) => {
      if (url.includes('tile.googleapis.com')) throw new Error('offline');
      return new Response(null, { status: 404 });
    },
  });
  assert.equal(route, 'direct');
});

test('the probe gives up at its deadline instead of waiting', async () => {
  const started = Date.now();
  const route = await chooseTileRoute({
    apiKey: 'real-key',
    timeoutMs: 40,
    fetchImpl: (url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(new Error('aborted')),
        );
      }),
  });
  assert.equal(route, 'direct');
  assert.ok(Date.now() - started < 1000);
});

test('relaying points Cesium at the same-origin mount', () => {
  const Cesium = {
    GoogleMaps: { defaultApiKey: undefined, mapTilesApiEndpoint: null },
    Resource: class {
      constructor(options) {
        Object.assign(this, options);
      }
    },
  };
  assert.equal(relayGoogleTiles(Cesium), true);
  assert.match(
    Cesium.GoogleMaps.mapTilesApiEndpoint,
    /\/api\/google\/tiles\/$/,
  );
  assert.equal(Cesium.GoogleMaps.defaultApiKey, 'relayed-by-server');
  assert.equal(TILES_RELAY_PATH, GOOGLE_TILES_PATH);
});

/* ── the server's relay ───────────────────────────────────────────── */

function mount(relay) {
  let handler = null;
  relay.configurePreviewServer({
    middlewares: {
      use: (path, fn) => {
        handler = fn;
      },
    },
  });
  return handler;
}

function request({ url, method = 'GET' }) {
  return {
    url,
    method,
    headers: {
      host: 'localhost:4173',
      origin: 'http://localhost:4173',
      'sec-fetch-site': 'same-origin',
    },
    socket: { encrypted: false },
  };
}

function response() {
  const headers = new Map();
  return {
    statusCode: 200,
    ended: false,
    body: null,
    setHeader: (name, value) => headers.set(name.toLowerCase(), value),
    getHeader: (name) => headers.get(name.toLowerCase()),
    end(body) {
      this.ended = true;
      this.body = body ?? null;
    },
  };
}

const stream = (body) => ({
  pipe: async (res) => res.end(await new Response(body).text()),
});

test('the mount is stripped and Google keeps its path', () => {
  assert.equal(
    upstreamPath(`${GOOGLE_TILES_PATH}/v1/3dtiles/root.json`),
    '/v1/3dtiles/root.json',
  );
  assert.equal(
    upstreamPath('/api/google/tiles/s1/2/tile.b3dm?v=1'),
    '/s1/2/tile.b3dm?v=1',
  );
});

test('the relay swaps the placeholder key for the server key', async () => {
  const seen = [];
  const handler = mount(
    googleTilesRelay({
      apiKey: () => 'server-key',
      fetchImpl: async (url, init) => {
        seen.push({ url, referer: init?.headers?.Referer });
        return new Response('{"asset":{}}', {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Content-Encoding': 'gzip',
          },
        });
      },
      toNodeStream: stream,
    }),
  );
  const res = response();
  await handler(
    request({ url: `${GOOGLE_TILES_PATH}/v1/3dtiles/root.json?key=relayed-by-server` }),
    res,
  );

  assert.equal(seen.length, 1);
  assert.equal(
    seen[0].url,
    'https://tile.googleapis.com/v1/3dtiles/root.json?key=server-key',
  );
  // The key is referrer-restricted; the relay must present the allowed one.
  assert.equal(seen[0].referer, 'https://ion.cesium.com/');
  assert.equal(res.statusCode, 200);
  assert.equal(res.getHeader('content-type'), 'application/json');
  // `fetch` already decoded the body; forwarding the header would double it.
  assert.equal(res.getHeader('content-encoding'), undefined);
  assert.match(String(res.getHeader('cache-control')), /private/);
});

test('a session redirect is followed on the server', async () => {
  const calls = [];
  const handler = mount(
    googleTilesRelay({
      apiKey: () => 'server-key',
      fetchImpl: async (url) => {
        calls.push(url);
        if (calls.length === 1) {
          return new Response(null, {
            status: 307,
            headers: { Location: 'https://tile.googleapis.com/v1/3dtiles/s/1/root.json' },
          });
        }
        return new Response('root', { status: 200 });
      },
      toNodeStream: stream,
    }),
  );
  const res = response();
  await handler(request({ url: `${GOOGLE_TILES_PATH}/v1/3dtiles/root.json` }), res);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /\/v1\/3dtiles\/s\/1\/root\.json/);
  assert.equal(res.statusCode, 200);
});

test('without a server key the relay declines and never calls Google', async () => {
  let called = false;
  const handler = mount(
    googleTilesRelay({
      apiKey: () => '',
      fetchImpl: async () => {
        called = true;
        return new Response('');
      },
    }),
  );
  const res = response();
  await handler(request({ url: `${GOOGLE_TILES_PATH}/v1/3dtiles/root.json` }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(called, false);
});

test('the client probe is answered without touching Google', async () => {
  let called = false;
  const handler = mount(
    googleTilesRelay({
      apiKey: () => 'server-key',
      fetchImpl: async () => {
        called = true;
        return new Response('');
      },
    }),
  );
  const res = response();
  await handler(request({ url: GOOGLE_TILES_PATH, method: 'HEAD' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(called, false);
});

test('a failed relay puts the direct Google endpoint back', () => {
  const Cesium = {
    GoogleMaps: { mapTilesApiEndpoint: null },
    Resource: class {
      constructor(options) {
        Object.assign(this, options);
      }
    },
  };
  relayGoogleTiles(Cesium);
  assert.match(Cesium.GoogleMaps.mapTilesApiEndpoint, /\/api\//);
  assert.equal(restoreDirectTiles(Cesium), true);
  assert.equal(Cesium.GoogleMaps.mapTilesApiEndpoint, 'https://tile.googleapis.com/');
});

test('the relay answers its own mount for GET, the probe this client sends', async () => {
  let called = false;
  const handler = mount(
    googleTilesRelay({
      apiKey: () => 'server-key',
      fetchImpl: async () => {
        called = true;
        return new Response('');
      },
    }),
  );
  for (const url of [GOOGLE_TILES_PATH, `${GOOGLE_TILES_PATH}/`]) {
    const res = response();
    await handler(request({ url }), res);
    assert.equal(res.statusCode, 200, url);
  }
  // Forwarding the empty path would put Google's own 404 page in front of the
  // client and look like the relay does not exist.
  assert.equal(called, false);
});

test('the endpoint is a string, so Cesium can interpolate it', () => {
  const Cesium = {
    GoogleMaps: { defaultApiKey: undefined, mapTilesApiEndpoint: null },
  };
  relayGoogleTiles(Cesium);
  // `createGooglePhotorealistic3DTileset` builds the root URL as
  // `${GoogleMaps.mapTilesApiEndpoint}v1/3dtiles/root.json`; anything that does
  // not stringify to the origin produces an unusable URL.
  assert.equal(typeof Cesium.GoogleMaps.mapTilesApiEndpoint, 'string');
  assert.equal(
    `${Cesium.GoogleMaps.mapTilesApiEndpoint}v1/3dtiles/root.json`,
    `${globalThis.location?.origin ?? 'http://localhost'}/api/google/tiles/v1/3dtiles/root.json`,
  );
});

test('child URIs stay under the relay mount', () => {
  const doc = JSON.stringify({
    root: {
      children: [
        { content: { uri: '/v1/3dtiles/datasets/a.glb?session=s' } },
      ],
    },
  });
  const out = JSON.parse(rewriteDocumentUris(doc, GOOGLE_TILES_PATH));
  assert.equal(
    out.root.children[0].content.uri,
    `${GOOGLE_TILES_PATH}/v1/3dtiles/datasets/a.glb?session=s`,
  );
  // Rewriting twice must not stack the prefix.
  const again = JSON.parse(
    rewriteDocumentUris(JSON.stringify(out), GOOGLE_TILES_PATH),
  );
  assert.equal(again.root.children[0].content.uri, out.root.children[0].content.uri);
});

test('a non-JSON body is passed through untouched', () => {
  assert.equal(rewriteDocumentUris('not json', GOOGLE_TILES_PATH), 'not json');
});
