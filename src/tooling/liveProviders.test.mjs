import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { setTimeout as delay } from 'node:timers/promises';
import * as providers from '../../server/providers/live.js';
import * as portable from '../../src/data/adsbLolFallback.js';

function install(plugin, preview = false) {
  const routes = new Map();
  plugin[preview ? 'configurePreviewServer' : 'configureServer']({
    middlewares: {
      use(route, handler) {
        routes.set(route, handler);
      },
    },
  });
  return async (route, url = '/', method = 'GET') => {
    assert.ok(routes.has(route), `registered route: ${route}`);
    const response = {
      statusCode: 200,
      headers: {},
      setHeader(key, value) {
        this.headers[key.toLowerCase()] = value;
      },
      writeHead(status, headers = {}) {
        this.statusCode = status;
        for (const [key, value] of Object.entries(headers))
          this.setHeader(key, value);
      },
      end(body) {
        this.body = body;
      },
    };
    await routes.get(route)({ url, method }, response);
    return response;
  };
}

/** A response that streams 1 MiB chunks of `text` well past every cap, then ends. */
function oversizedResponse(text, init = {}) {
  const state = { pulled: 0, cancelled: false };
  const chunk = new TextEncoder().encode(
    text.repeat(Math.ceil((1 << 20) / text.length)),
  );
  const response = new Response(
    new ReadableStream(
      {
        pull(controller) {
          if (++state.pulled > 40) controller.close();
          else controller.enqueue(chunk);
        },
        cancel() {
          state.cancelled = true;
        },
      },
      { highWaterMark: 0 },
    ),
    init,
  );
  return { response, state };
}

function environment(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const original = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    t.after(() => {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    });
  }
}

test('live entry resolves in Node and aircraft normalization stays independently portable', async () => {
  const entry = await import('gods-eye-view/server/providers/live');
  assert.equal(entry.openSkyProxy, providers.openSkyProxy);
  assert.equal(entry.aisLiveProxy, providers.aisLiveProxy);
  const normalizer = await import('gods-eye-view/sources/adsb-lol');
  assert.equal(
    normalizer.normalizeAdsbLolAircraftState,
    portable.normalizeAdsbLolAircraftState,
  );
});

test('AIS preview route ingests through the socket, returns tracks and disposes before restart', async (t) => {
  const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(upstream, 'listening');
  const sockets = [];
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    await new Promise((resolve) => upstream.close(resolve));
  });
  environment(t, {
    AISSTREAM_API_KEY: 'fixture-key',
    AISSTREAM_URL: `ws://127.0.0.1:${upstream.address().port}`,
    AISSTREAM_BOUNDING_BOXES: undefined,
    AISSTREAM_MESSAGE_TYPES: undefined,
    AISSTREAM_SILENCE_TIMEOUT_MS: '0',
  });
  upstream.on('connection', (socket) => {
    sockets.push(socket);
    socket.on('message', (raw) => {
      assert.equal(JSON.parse(raw).APIKey, 'fixture-key');
      for (const [lat, epoch] of [
        [30, Math.floor(Date.now() / 1000) - 120],
        [30.01, Math.floor(Date.now() / 1000) - 60],
      ]) {
        socket.send(
          JSON.stringify({
            MessageType: 'PositionReport',
            MetaData: {
              MMSI: 123456789,
              latitude: lat,
              longitude: -97,
              time_utc: new Date(epoch * 1000).toISOString(),
            },
            Message: {
              PositionReport: {
                UserID: 123456789,
                Sog: 10,
                Cog: 90,
                TrueHeading: 511,
              },
            },
          }),
        );
      }
    });
  });
  const plugin = providers.aisLiveProxy();
  t.after(() => plugin.closeBundle());
  const request = install(plugin, true);
  let res;
  for (let i = 0; i < 100; i++) {
    res = await request('/api/vessels');
    if (JSON.parse(res.body).rows.length) break;
    await delay(10);
  }
  const data = JSON.parse(res.body);
  assert.equal(data.status, 'live');
  assert.equal(data.rows[0].mmsi, '123456789');
  assert.equal(data.rows[0].heading, null);
  const history = await request('/api/vessels', '/track?mmsi=123456789');
  assert.equal(JSON.parse(history.body).samples.length, 2);
  assert.equal(
    (await request('/api/vessels', '/track?mmsi=bad')).statusCode,
    400,
  );
  assert.equal(sockets.length, 1);
  plugin.closeBundle();
  for (let i = 0; i < 100 && sockets[0].readyState !== 3; i++) await delay(10);
  assert.equal(sockets[0].readyState, 3);
  const restarted = install(plugin);
  await restarted('/api/vessels');
  for (let i = 0; i < 100 && sockets.length < 2; i++) await delay(10);
  assert.equal(sockets.length, 2);
});

test('track backfill proxy returns 502 on an oversized upstream body and caches it as an error', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'gev-track-cap-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const tracks = install(
    providers.trackBackfillProxies({
      directory,
      tokenProvider: async () => 'fixture',
      quota: { fetch: (...args) => globalThis.fetch(...args), waitMs: () => 0 },
    }),
    true,
  );
  let callCount = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    callCount++;
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      body: (async function* () {
        yield Buffer.alloc(6 * 1024 * 1024, 'x');
      })(),
    };
  });

  const res1 = await tracks('/api/flights/track', '?icao24=def456');
  assert.equal(res1.statusCode, 502);
  assert.deepEqual(JSON.parse(res1.body), {
    error: 'Upstream track response too large',
  });

  // Cached as a 502 (never a 200): a retry inside the window neither
  // reads as an empty track nor spends OpenSky credits on another download.
  const res2 = await tracks('/api/flights/track', '?icao24=def456');
  assert.equal(res2.statusCode, 502);
  assert.equal(callCount, 1);
});
