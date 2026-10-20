import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adsbLolProxy } from './adsb-lol.js';

function setup(
  t,
  {
    fetchImpl,
    directory,
    clock = { value: 1_800_000_000_000 },
    waitMs = () => 0,
  } = {},
) {
  t.mock.method(globalThis, 'fetch', async () => {
    throw Error('Unexpected live transport in test');
  });
  const dir = directory || mkdtempSync(join(tmpdir(), 'gev-adsb-cache-'));
  if (!directory) t.after(() => rmSync(dir, { recursive: true, force: true }));
  let calls = 0;
  let task;
  const plugin = adsbLolProxy({
    directory: dir,
    now: () => clock.value,
    quota: {
      waitMs,
      fetch: async (...args) => {
        calls++;
        return fetchImpl
          ? fetchImpl(...args)
          : Response.json({ now: clock.value / 1000, ac: [{ hex: 'abc123' }] });
      },
    },
    setTimer: (fn) => {
      task = fn;
      return { unref() {} };
    },
    clearTimer: () => {
      task = null;
    },
  });
  t.after(() => plugin.closeBundle());
  let handler;
  plugin.configureServer({
    middlewares: {
      use: (_path, fn) => {
        handler = fn;
      },
    },
  });
  const request = async () => {
    const res = {
      headers: {},
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers;
      },
      end(body) {
        this.body = body;
      },
    };
    await handler({ method: 'GET', url: '/' }, res, () => {});
    return res;
  };
  return {
    plugin,
    request,
    dir,
    clock,
    get calls() {
      return calls;
    },
    tick: () => task?.(),
  };
}

test('cold requests never initiate or duplicate collection and scheduled refresh is independent', async (t) => {
  let release;
  const f = setup(t, {
    fetchImpl: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const pending = await Promise.all(
    Array.from({ length: 30 }, () => f.request()),
  );
  assert.ok(pending.every((r) => r.status === 503));
  assert.equal(f.calls, 1, 'startup collector is the only upstream read');
  release(Response.json({ now: f.clock.value / 1000, ac: [] }));
  await f.plugin.ready();
  const fresh = await f.request();
  assert.equal(fresh.status, 200);
  assert.equal(fresh.headers['X-Feed-Next-Refresh-Ms'], '240000');
  f.clock.value += 239999;
  await Promise.all(Array.from({ length: 30 }, () => f.request()));
  assert.equal(f.calls, 1);
  f.clock.value++;
  f.tick();
  assert.equal(
    f.calls,
    2,
    'background timer fetches without any frontend request',
  );
  release(Response.json({ now: f.clock.value / 1000, ac: [] }));
  await f.plugin.ready();
});

test('persisted snapshots retain their real age across restarts and expiry', async (t) => {
  const f = setup(t);
  await f.plugin.ready();
  f.plugin.closeBundle();
  f.clock.value += 60000;
  const restart = setup(t, { directory: f.dir, clock: f.clock });
  assert.equal(
    restart.calls,
    0,
    'startup does not bypass the previous collection interval',
  );
  const res = await restart.request();
  assert.equal(res.status, 200);
  assert.equal(res.headers['X-Feed-Age-Ms'], '60000');
  assert.equal(res.headers['X-Feed-Next-Refresh-Ms'], '180000');
  f.clock.value += 86400000;
  assert.equal(
    (await restart.request()).status,
    503,
    'day-old positions are unavailable',
  );
});

test('invalid snapshots cannot overwrite a good cache and disposal discards late writes', async (t) => {
  let reply;
  const clock = { value: 1_800_000_000_000 };
  const f = setup(t, {
    clock,
    fetchImpl: async () =>
      reply || Response.json({ now: clock.value / 1000, ac: [] }),
  });
  await f.plugin.ready();
  f.clock.value += 240000;
  reply = Response.json({ ac: [] });
  f.tick();
  await f.plugin.ready();
  const res = await f.request();
  assert.equal(res.headers['X-Feed-Cache'], 'STALE');
  assert.equal(JSON.parse(res.body).now, (f.clock.value - 240000) / 1000);
  let finish;
  const g = setup(t, {
    fetchImpl: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  g.plugin.closeBundle();
  finish(Response.json({ now: g.clock.value / 1000, ac: [] }));
  await g.plugin.ready();
  assert.equal((await g.request()).status, 503);
});

test('shared upstream holds are returned as service cache metadata, not repeated 429 requests', async (t) => {
  const f = setup(t, { waitMs: () => 86400000 });
  assert.equal(f.calls, 0);
  const res = await f.request();
  assert.equal(res.status, 503);
  assert.equal(res.headers['Retry-After'], '86400');
  assert.equal(res.headers['X-Feed-Next-Refresh-Ms'], '86400000');
});

test('oversized upstream bodies are cancelled and never saved as snapshots', async (t) => {
  let cancelled = false;
  const f = setup(t, {
    fetchImpl: async () =>
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

test('independent collectors see another worker publish without making a vendor request', async (t) => {
  let release;
  const first = setup(t, {
    fetchImpl: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const second = setup(t, {
    directory: first.dir,
    clock: first.clock,
    waitMs: () => 240000,
  });
  assert.equal((await second.request()).status, 503);
  release(Response.json({ now: first.clock.value / 1000, ac: [] }));
  await first.plugin.ready();
  assert.equal((await second.request()).status, 200);
  assert.equal(
    second.calls,
    0,
    'reading a peer snapshot never contacts upstream',
  );
});
