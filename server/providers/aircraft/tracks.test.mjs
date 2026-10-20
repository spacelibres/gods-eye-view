import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trackBackfillProxies } from './tracks.js';

async function fixture(t, fetchImpl, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'gev-tracks-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let clock = 1000000;
  let calls = 0;
  const quota = {
    waitMs: () => 0,
    fetch: async (...args) => {
      calls++;
      return fetchImpl(...args);
    },
  };
  const settings = {
    directory,
    now: () => clock,
    quota,
    tokenProvider: async () => 'fixture-token',
    ...options,
  };
  const create = () => {
    const routes = new Map();
    trackBackfillProxies(settings).configureServer({
      middlewares: { use: (path, fn) => routes.set(path, fn) },
    });
    return async (icao24 = 'abcdef', signal) => {
      const res = {
        headers: {},
        setHeader(k, v) {
          this.headers[k.toLowerCase()] = v;
        },
        end(body) {
          this.body = body;
        },
      };
      await routes.get('/api/flights/track')(
        { url: `?icao24=${icao24}`, signal },
        res,
      );
      return res;
    };
  };
  return {
    directory,
    create,
    get calls() {
      return calls;
    },
    advance: (ms) => {
      clock += ms;
    },
  };
}

test('concurrent same-aircraft readers share one authenticated quota request and durable cache', async (t) => {
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const f = await fixture(t, async (url, options) => {
    assert.match(url, /tracks\/all\?icao24=abcdef/);
    assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    await gate;
    return Response.json({ path: [[123, 1, 2]] });
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ legacy: true });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const request = f.create();
  const a = request();
  const b = request();
  release();
  const results = await Promise.all([a, b]);
  assert.equal(f.calls, 1);
  assert.equal(results[0].body, results[1].body);
  assert.equal((await f.create()()).body, results[0].body);
  assert.equal(f.calls, 1);
  f.advance(60001);
  await request();
  assert.equal(f.calls, 2);
});

test('complete retry deadline persists across proxy restart', async (t) => {
  const f = await fixture(
    t,
    async () =>
      new Response('', { status: 429, headers: { 'Retry-After': '10800' } }),
  );
  assert.equal((await f.create()()).statusCode, 429);
  f.advance(60001);
  assert.equal((await f.create()()).statusCode, 429);
  assert.equal(f.calls, 1);
  f.advance(10800000);
  await f.create()();
  assert.equal(f.calls, 2);
});

test('network failures are negatively cached and do not strand in-flight readers', async (t) => {
  const f = await fixture(t, async () => {
    throw new Error('offline');
  });
  const request = f.create();
  const results = await Promise.all([request(), request()]);
  assert.deepEqual(
    results.map((r) => r.statusCode),
    [502, 502],
  );
  await request();
  assert.equal(f.calls, 1);
  f.advance(60001);
  await request();
  assert.equal(f.calls, 2);
});

test('OAuth failure never falls back to an anonymous track request', async (t) => {
  const f = await fixture(t, async () => Response.json({}), {
    tokenProvider: async () => {
      throw new Error('OAuth failed');
    },
  });
  assert.equal((await f.create()()).statusCode, 502);
  assert.equal(f.calls, 0);
});

test('oversized bodies retain the public 502 error and cache it', async (t) => {
  const f = await fixture(
    t,
    async () =>
      new Response('x', {
        headers: { 'Content-Length': String(5 * 1024 * 1024 + 1) },
      }),
  );
  const request = f.create();
  const result = await request();
  assert.equal(result.statusCode, 502);
  assert.match(result.body, /too large/);
  await request();
  assert.equal(f.calls, 1);
});

test('persisted cache is bounded by entry count and total body bytes', async (t) => {
  let body = '{}';
  const f = await fixture(t, async () => new Response(body));
  const request = f.create();
  const entries = Array.from({ length: 200 }, (_, i) => [
    i.toString(16).padStart(6, '0'),
    { at: 1000000, until: 1060000, status: 200, body: '{}' },
  ]);
  await writeFile(
    join(f.directory, 'tracks-cache.json'),
    JSON.stringify({ entries }),
  );
  for (let i = 200; i < 205; i++)
    await request(i.toString(16).padStart(6, '0'));
  let stored = JSON.parse(
    await readFile(join(f.directory, 'tracks-cache.json'), 'utf8'),
  );
  assert.equal(stored.entries.length, 200);
  body = 'x'.repeat(3 * 1024 * 1024);
  await request('fff001');
  await request('fff002');
  stored = JSON.parse(
    await readFile(join(f.directory, 'tracks-cache.json'), 'utf8'),
  );
  assert.ok(stored.entries.length <= 200);
  assert.ok(Buffer.byteLength(JSON.stringify(stored)) <= 5 * 1024 * 1024);
});

test('missing OAuth token returns 503 without spending the track bucket', async (t) => {
  const f = await fixture(t, async () => Response.json({}), {
    tokenProvider: async () => null,
  });
  assert.equal((await f.create()()).statusCode, 503);
  assert.equal(f.calls, 0);
});

test('responses that exceed the serialized cache cap cannot cause repeated downloads', async (t) => {
  const f = await fixture(
    t,
    async () => new Response('"'.repeat(3 * 1024 * 1024)),
  );
  const first = await f.create()();
  await f.create()();
  assert.equal(first.statusCode, 502);
  assert.equal(f.calls, 1);
});

test('503 retry headers suppress refresh for their complete duration', async (t) => {
  const f = await fixture(
    t,
    async () =>
      new Response('', {
        status: 503,
        headers: {
          'Retry-After': new Date(1000000 + 4 * 3600000).toUTCString(),
        },
      }),
  );
  const request = f.create();
  assert.equal((await request()).statusCode, 503);
  f.advance(3600000);
  assert.equal((await f.create()()).statusCode, 503);
  assert.equal(f.calls, 1);
});

test('one disconnected browser does not cancel another reader sharing the track', async (t) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const f = await fixture(t, async (_url, options) => {
    await gate;
    assert.equal(options.signal.aborted, false);
    return Response.json({ path: [] });
  });
  const request = f.create();
  const disconnected = new AbortController();
  const first = request('abcdef', disconnected.signal);
  const second = request();
  disconnected.abort();
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  assert.equal(f.calls, 1);
});

test('an endless 429 body is cancelled without delaying its durable retry deadline', async (t) => {
  let cancelled = false;
  let controller;
  const f = await fixture(
    t,
    async () =>
      new Response(
        new ReadableStream({
          start(value) {
            controller = value;
          },
          cancel() {
            cancelled = true;
            // Even a stalled transport cancellation must not delay the known error.
            return new Promise(() => {});
          },
        }),
        { status: 429, headers: { 'Retry-After': '10800' } },
      ),
  );
  t.after(() => {
    try {
      controller?.close();
    } catch {}
  });
  let timer;
  const result = await Promise.race([
    f.create()(),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), 1000);
    }),
  ]);
  clearTimeout(timer);
  assert.notEqual(result, null, 'known HTTP error must not wait for its body');
  assert.equal(result.statusCode, 429);
  assert.equal(result.headers['retry-after'], '10800');
  assert.equal(cancelled, true);
  f.advance(60001);
  assert.equal((await f.create()()).statusCode, 429);
  assert.equal(f.calls, 1);
  const saved = JSON.parse(
    await readFile(join(f.directory, 'tracks-cache.json'), 'utf8'),
  );
  assert.equal(saved.entries[0][1].until, 1000000 + 10800000);
});

test('cache reservation failure stops the request before spending upstream credits', async (t) => {
  const f = await fixture(t, async () => Response.json({ path: [] }));
  await writeFile(join(f.directory, 'tracks-cache.json.lock'), 'held by peer');
  const result = await f.create()();
  assert.equal(result.statusCode, 503);
  assert.ok(Number(result.headers['retry-after']) > 0);
  assert.equal(f.calls, 0);
});

async function startWorker(t, directory, icao24, holdBody = false) {
  const { spawn } = await import('node:child_process');
  const source = `
    import { appendFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { trackBackfillProxies } from ${JSON.stringify(new URL('./tracks.js', import.meta.url).href)};
    const routes = new Map();
    const quota = { waitMs: () => 0, fetch: async () => {
      appendFileSync(join(${JSON.stringify(directory)}, 'attempts.log'), 'attempt\\n');
      if (!${holdBody}) return Response.json({ path: [${JSON.stringify(icao24)}] });
      return new Response(new ReadableStream({ start(controller) {
        process.on('message', (message) => {
          if (message === 'release') {
            controller.enqueue(new TextEncoder().encode(JSON.stringify({ path: [${JSON.stringify(icao24)}] })));
            controller.close();
          }
        });
        process.send({ type: 'upstream' });
      } }));
    } };
    trackBackfillProxies({ directory: ${JSON.stringify(directory)}, quota, tokenProvider: async () => 'test', now: () => 1000000 })
      .configureServer({ middlewares: { use: (path, fn) => routes.set(path, fn) } });
    const result = { headers: {}, setHeader(k,v) { this.headers[k.toLowerCase()] = v; }, end(body) { this.body = body; } };
    await routes.get('/api/flights/track')({ url: '?icao24=${icao24}' }, result);
    process.send({ type: 'result', status: result.statusCode, headers: result.headers, body: result.body });
    process.disconnect();
  `;
  const worker = spawn(
    process.execPath,
    ['--input-type=module', '--eval', source],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
  );
  t.after(() => {
    worker.kill();
  });
  const messages = [];
  const waiters = [];
  let stderr = '';
  worker.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  worker.on('message', (message) => {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(message);
    else messages.push(message);
  });
  worker.on('exit', (code) => {
    for (const waiter of waiters.splice(0))
      waiter.reject(new Error(`Worker exited ${code}: ${stderr}`));
  });
  return {
    worker,
    next: () =>
      messages.length
        ? Promise.resolve(messages.shift())
        : new Promise((resolve, reject) => waiters.push({ resolve, reject })),
  };
}

test(
  'separate workers share a durable reservation while the successful response body is pending',
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t, async () => {
      throw new Error('parent must not fetch');
    });
    const first = await startWorker(t, f.directory, 'abcdef', true);
    assert.equal((await first.next()).type, 'upstream');
    const peer = await startWorker(t, f.directory, 'abcdef');
    const pending = await peer.next();
    assert.equal(pending.status, 503);
    assert.equal(pending.headers['retry-after'], '60');
    first.worker.send('release');
    assert.equal((await first.next()).status, 200);
    const replay = await startWorker(t, f.directory, 'abcdef');
    assert.equal((await replay.next()).status, 200);
    assert.equal(
      (await readFile(join(f.directory, 'attempts.log'), 'utf8')).split(
        'attempt',
      ).length - 1,
      1,
    );
  },
);

test(
  'separate workers retain both aircraft when their refreshes complete together',
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t, async () => {
      throw new Error('parent must not fetch');
    });
    const first = await startWorker(t, f.directory, 'abcdef', true);
    const second = await startWorker(t, f.directory, '123456', true);
    assert.equal((await first.next()).type, 'upstream');
    assert.equal((await second.next()).type, 'upstream');
    first.worker.send('release');
    second.worker.send('release');
    assert.equal((await first.next()).status, 200);
    assert.equal((await second.next()).status, 200);
    const saved = JSON.parse(
      await readFile(join(f.directory, 'tracks-cache.json'), 'utf8'),
    );
    assert.deepEqual(
      saved.entries.map(([key, entry]) => [key, entry.status]).sort(),
      [
        ['123456', 200],
        ['abcdef', 200],
      ],
    );
  },
);

test(
  'a crashed worker reservation suppresses peers for sixty seconds then permits a new accounted attempt',
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t, async () => Response.json({ path: [] }));
    const crashed = await startWorker(t, f.directory, 'abcdef', true);
    assert.equal((await crashed.next()).type, 'upstream');
    crashed.worker.kill();
    assert.equal((await f.create()()).statusCode, 503);
    assert.equal(f.calls, 0);
    f.advance(60001);
    assert.equal((await f.create()()).statusCode, 200);
    assert.equal(f.calls, 1);
  },
);

test('live reservations cannot be evicted to admit another aircraft', async (t) => {
  const f = await fixture(t, async () => Response.json({ path: [] }));
  const entries = Array.from({ length: 200 }, (_, i) => [
    i.toString(16).padStart(6, '0'),
    {
      at: 1000000,
      until: 1060000,
      status: 503,
      pending: `worker-${i}`,
      body: '{}',
    },
  ]);
  await writeFile(
    join(f.directory, 'tracks-cache.json'),
    JSON.stringify({ entries }),
  );
  assert.equal((await f.create()('ffffff')).statusCode, 503);
  assert.equal(f.calls, 0);
  const saved = JSON.parse(
    await readFile(join(f.directory, 'tracks-cache.json'), 'utf8'),
  );
  assert.equal(saved.entries.length, 200);
  assert.ok(saved.entries.every(([, entry]) => entry.pending));
});

test('a malformed cache cannot discard a peer reservation and authorize a new request', async (t) => {
  const f = await fixture(t, async () => Response.json({ path: [] }));
  await writeFile(
    join(f.directory, 'tracks-cache.json'),
    JSON.stringify({ entries: 'invalid' }),
  );
  assert.equal((await f.create()()).statusCode, 503);
  assert.equal(f.calls, 0);
});
