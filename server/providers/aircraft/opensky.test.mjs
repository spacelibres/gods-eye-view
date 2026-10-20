import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSkyProxy } from './opensky.js';

function setup(
  t,
  {
    transport,
    directory,
    clock = { at: 1800000000000 },
    waitMs = () => 0,
    tokenProvider = async () => 'fixture',
  } = {},
) {
  t.mock.method(globalThis, 'fetch', async () => {
    throw Error('Live cloud forbidden in unit test');
  });
  const dir =
    directory || mkdtempSync(join(tmpdir(), 'gev-opensky-collector-'));
  if (!directory) t.after(() => rmSync(dir, { recursive: true, force: true }));
  let calls = 0,
    tick,
    invalidations = 0;
  const plugin = openSkyProxy({
    directory: dir,
    now: () => clock.at,
    tokenProvider,
    authMode: 'oauth',
    invalidateToken: () => invalidations++,
    quota: {
      waitMs,
      fetch: async (url, options) => {
        calls++;
        assert.equal(options.headers.Authorization, 'Bearer fixture');
        return transport
          ? transport(url, options)
          : Response.json({ time: clock.at / 1000, states: [] });
      },
    },
    setTimer: (fn) => {
      tick = fn;
      return { unref() {} };
    },
    clearTimer: () => {},
  });
  t.after(() => plugin.closeBundle());
  let handler;
  const install = () =>
    plugin.configureServer({
      middlewares: {
        use: (_route, fn) => {
          handler = fn;
        },
      },
    });
  install();
  return {
    plugin,
    clock,
    dir,
    tick: () => tick?.(),
    install,
    get calls() {
      return calls;
    },
    get invalidations() {
      return invalidations;
    },
    request: async (url = '/') => {
      const r = {
        headers: {},
        setHeader(k, v) {
          this.headers[k] = v;
        },
        writeHead(status, headers) {
          this.status = status;
          Object.assign(this.headers, headers);
        },
        end(body) {
          this.body = body;
        },
      };
      await handler({ url, method: 'GET' }, r, () => {});
      return r;
    },
  };
}

test('only the VPS scheduler acquires data; concurrent browsers cannot trigger another read', async (t) => {
  let resolve;
  const f = setup(t, {
    transport: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  await new Promise((done) => setImmediate(done));
  const cold = await Promise.all(Array.from({ length: 30 }, () => f.request()));
  assert.ok(cold.every((r) => r.status === 503));
  assert.equal(f.calls, 1);
  resolve(Response.json({ time: f.clock.at / 1000, states: [] }));
  await f.plugin.ready();
  const a = await f.request('?lat=30&lon=-97'),
    b = await f.request('?lat=50&lon=10');
  assert.equal(a.status, 200);
  assert.equal(a.body, b.body);
  assert.equal(f.calls, 1);
  assert.equal(a.headers['X-Feed-Next-Refresh-Ms'], '120000');
  f.clock.at += 120000;
  f.tick();
  await new Promise((done) => setImmediate(done));
  assert.equal(f.calls, 2);
  resolve(Response.json({ time: f.clock.at / 1000, states: [] }));
  await f.plugin.ready();
});

test('restarts and peer workers load the shared real source epoch without fetching again', async (t) => {
  const f = setup(t);
  await f.plugin.ready();
  f.plugin.closeBundle();
  f.clock.at += 60000;
  const peer = setup(t, {
    directory: f.dir,
    clock: f.clock,
    waitMs: () => 60000,
  });
  await peer.plugin.ready();
  const r = await peer.request();
  assert.equal(r.status, 200);
  assert.equal(peer.calls, 0);
  assert.equal(JSON.parse(r.body).time, (f.clock.at - 60000) / 1000);
  assert.equal(r.headers['X-Feed-Age-Ms'], '60000');
  f.clock.at += 86400000;
  assert.equal((await peer.request()).status, 503);
});

test('malformed and retrograde snapshots never replace last-good data', async (t) => {
  const clock = { at: 1800000000000 };
  let body;
  const f = setup(t, {
    clock,
    transport: async () =>
      body || Response.json({ time: clock.at / 1000, states: [] }),
  });
  await f.plugin.ready();
  const first = (await f.request()).body;
  clock.at += 120000;
  body = Response.json({ states: [] });
  f.tick();
  await f.plugin.ready();
  assert.equal((await f.request()).body, first);
  assert.equal((await f.request()).headers['X-OpenSky-Cache'], 'STALE');
  clock.at += 120000;
  body = Response.json({ time: (clock.at - 300000) / 1000, states: [] });
  f.tick();
  await f.plugin.ready();
  assert.equal((await f.request()).body, first);
});

test('auth failures invalidate the token and browser requests never start extra authentication attempts', async (t) => {
  const f = setup(t, {
    transport: async () => new Response('', { status: 401 }),
  });
  await f.plugin.ready();
  assert.equal(f.invalidations, 1);
  assert.equal((await f.request()).status, 503);
  await f.request();
  assert.equal(f.calls, 1);
  const g = setup(t, { tokenProvider: async () => null });
  await g.plugin.ready();
  assert.equal(g.calls, 0);
  assert.equal(
    (await g.request()).headers['X-OpenSky-Auth-Reason'],
    'oauth_invalid_or_missing',
  );
});

test('full shared cooldown is returned to clients and no local fast retry is scheduled', async (t) => {
  const f = setup(t, { waitMs: () => 72000000 });
  await f.plugin.ready();
  assert.equal(f.calls, 0);
  const r = await f.request();
  assert.equal(r.status, 503);
  assert.equal(r.headers['Retry-After'], '72000');
});

test('stopping collection aborts and cannot publish a late cloud reply', async (t) => {
  let done;
  const f = setup(t, {
    transport: () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  f.plugin.closeBundle();
  done(Response.json({ time: f.clock.at / 1000, states: [] }));
  await f.plugin.ready();
  assert.equal((await f.request()).status, 503);
});

test('oversized snapshot is cancelled, never cached and never retried by browsers', async (t) => {
  let cancelled = false;
  const f = setup(t, {
    transport: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(9 * 1024 * 1024));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  });
  await f.plugin.ready();
  assert.equal(cancelled, true);
  assert.equal((await f.request()).status, 503);
  await Promise.all(Array.from({ length: 10 }, () => f.request()));
  assert.equal(f.calls, 1);
});

test('a stalled error cancellation cannot block the next collection cycle', async (t) => {
  const f = setup(t, {
    transport: async () =>
      new Response(
        new ReadableStream({
          cancel() {
            return new Promise(() => {});
          },
        }),
        { status: 429 },
      ),
  });
  await Promise.race([
    f.plugin.ready(),
    new Promise((_, reject) =>
      setTimeout(() => reject(Error('collector blocked on error body')), 1000),
    ),
  ]);
  assert.equal((await f.request()).status, 503);
  assert.equal(f.calls, 1);
});
