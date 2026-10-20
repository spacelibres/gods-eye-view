import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { createOpenSkyQuota, OPENSKY_DAY_MS } from './opensky-quota.js';

function setup(t, respond = () => Response.json({ states: [] })) {
  const directory = mkdtempSync(join(tmpdir(), 'gev-opensky-quota-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let clock = 1_800_000_000_000,
    calls = 0;
  const options = {
    directory,
    intervalMs: 0,
    now: () => clock,
    fetchImpl: async () => {
      calls++;
      return respond();
    },
  };
  return {
    options,
    gate: createOpenSkyQuota(options),
    tick: (ms) => {
      clock += ms;
    },
    get calls() {
      return calls;
    },
  };
}

test('1000 global attempts consume 4000 credits durably; tracks have an independent bucket', async (t) => {
  const f = setup(t);
  for (let i = 0; i < 1000; i++) {
    assert.equal((await f.gate.fetch('/api/states/all')).status, 200);
    f.tick(1000);
  }
  assert.equal(
    (await createOpenSkyQuota(f.options).fetch('/api/states/all')).status,
    429,
  );
  const ledger = JSON.parse(
    readFileSync(join(f.options.directory, 'states-quota.json')),
  );
  assert.equal(ledger.attempts.length, 1000);
  assert.equal(
    ledger.attempts.reduce((n, a) => n + a.cost, 0),
    4000,
  );
  assert.equal(
    (
      await createOpenSkyQuota({ ...f.options, bucket: 'tracks' }).fetch(
        '/api/tracks/all?icao24=abc123&time=0',
      )
    ).status,
    200,
  );
  f.tick(OPENSKY_DAY_MS);
  assert.equal((await f.gate.fetch('/api/states/all')).status, 200);
});

test('official long retry deadlines survive restart without a 30-minute cap', async (t) => {
  const f = setup(
    t,
    () =>
      new Response('', {
        status: 429,
        headers: {
          'X-Rate-Limit-Retry-After-Seconds': '72000',
          'X-Rate-Limit-Remaining': '0',
        },
      }),
  );
  await f.gate.fetch('/api/states/all');
  f.tick(3600000);
  assert.equal(createOpenSkyQuota(f.options).waitMs(), 68400000);
  assert.equal((await f.gate.fetch('/api/states/all')).status, 429);
  assert.equal(f.calls, 1);
});

test('missing quota headers do not become zero, but an unknown 429 pauses for a day', async (t) => {
  const f = setup(t);
  await f.gate.fetch('/api/states/all');
  f.tick(1000);
  assert.equal((await f.gate.fetch('/api/states/all')).status, 200);
  const g = setup(t, () => new Response('', { status: 429 }));
  await g.gate.fetch('/api/states/all');
  g.tick(1000);
  assert.equal(createOpenSkyQuota(g.options).waitMs(), OPENSKY_DAY_MS - 1000);
});

test('concurrent processes cannot spend the same remaining credits', async (t) => {
  let done;
  const f = setup(
    t,
    () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  );
  const a = f.gate.fetch('/api/states/all');
  f.tick(1000);
  assert.equal(
    (await createOpenSkyQuota(f.options).fetch('/api/states/all')).status,
    429,
  );
  done(
    Response.json(
      { states: [] },
      { headers: { 'X-Rate-Limit-Remaining': '3' } },
    ),
  );
  await a;
  f.tick(1000);
  assert.equal(
    (await createOpenSkyQuota(f.options).fetch('/api/states/all')).status,
    429,
  );
  assert.equal(f.calls, 1);
});

test('two-minute reservations and low-remaining adaptive cadence persist across restart', async (t) => {
  const f = setup(t, () =>
    Response.json(
      { states: [] },
      { headers: { 'X-Rate-Limit-Remaining': '400' } },
    ),
  );
  const gate = createOpenSkyQuota({ ...f.options, intervalMs: 120000 });
  await gate.fetch('/api/states/all');
  f.tick(1000);
  assert.equal(
    createOpenSkyQuota({ ...f.options, intervalMs: 120000 }).waitMs(),
    863000,
  );
  assert.equal((await gate.fetch('/api/states/all')).status, 429);
});

test('failed attempts stay charged, corrupt state fails closed, and origins are fixed', async (t) => {
  const f = setup(t, () => {
    throw Error('offline');
  });
  await assert.rejects(f.gate.fetch('/api/states/all'), /offline/);
  assert.equal(
    JSON.parse(readFileSync(join(f.options.directory, 'states-quota.json')))
      .attempts[0].cost,
    4,
  );
  await assert.rejects(
    f.gate.fetch('https://example.com/api/states/all'),
    /origin/,
  );
  writeFileSync(join(f.options.directory, 'states-quota.json'), '{bad');
  f.tick(1000);
  assert.equal((await f.gate.fetch('/api/states/all')).status, 503);
});

test('lost response persistence leaves a durable fail-closed marker', async (t) => {
  let file;
  const f = setup(t, () => {
    writeFileSync(file + '.lock', 'foreign');
    return new Response('', { status: 429 });
  });
  file = join(f.options.directory, 'states-quota.json');
  assert.equal((await f.gate.fetch('/api/states/all')).status, 503);
  rmSync(file + '.lock');
  f.tick(1000);
  assert.equal(
    (await createOpenSkyQuota(f.options).fetch('/api/states/all')).status,
    503,
  );
  assert.equal(f.calls, 1);
});

test('real response persistence failure still fails closed', async (t) => {
  const f = setup(t, () => {
    const ledger = join(f.options.directory, 'states-quota.json');
    rmSync(ledger);
    mkdirSync(ledger);
    return Response.json({ states: [] });
  });
  assert.equal((await f.gate.fetch('/api/states/all')).status, 503);
  assert.match(
    readFileSync(
      join(f.options.directory, 'states-quota.json.uncertain'),
      'utf8',
    ),
    /operator recovery/,
  );
  f.tick(OPENSKY_DAY_MS);
  assert.equal(
    (await createOpenSkyQuota(f.options).fetch('/api/states/all')).status,
    503,
  );
  assert.equal(f.calls, 1);
});

test('invalid oversized remaining header does not poison quota state', async (t) => {
  const f = setup(t, () =>
    Response.json(
      {},
      { headers: { 'X-Rate-Limit-Remaining': '999999999999999999999999' } },
    ),
  );
  assert.equal((await f.gate.fetch('/api/states/all')).status, 200);
  f.tick(1000);
  assert.equal(f.gate.waitMs(), 0);
});

test('storage failure does not await stalled response cancellation', async (t) => {
  let controller;
  const f = setup(t, () => {
    writeFileSync(join(f.options.directory, 'states-quota.json'), '{broken');
    return new Response(
      new ReadableStream({
        start(value) {
          controller = value;
        },
        cancel() {
          return new Promise(() => {});
        },
      }),
    );
  });
  t.after(() => {
    try {
      controller?.close();
    } catch {}
  });
  let timer;
  const response = await Promise.race([
    f.gate.fetch('/api/states/all'),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), 1000);
    }),
  ]);
  clearTimeout(timer);
  assert.notEqual(response, null);
  assert.equal(response.status, 503);
});

for (const networkFailure of [false, true]) {
  test(`temporary peer lock does not poison ${networkFailure ? 'failed' : 'successful'} response finalization`, async (t) => {
    let worker;
    const f = setup(t, async () => {
      worker = new Worker(
        `
        const { workerData, parentPort } = require('node:worker_threads');
        const { writeFileSync, unlinkSync } = require('node:fs');
        writeFileSync(workerData, 'peer', { flag: 'wx' });
        parentPort.postMessage('locked');
        setTimeout(() => unlinkSync(workerData), 150);
      `,
        {
          eval: true,
          workerData: join(f.options.directory, 'states-quota.json.lock'),
        },
      );
      await once(worker, 'message');
      if (networkFailure) throw new Error('offline');
      return Response.json({ states: [] });
    });
    t.after(async () => {
      await worker?.terminate();
    });
    if (networkFailure)
      await assert.rejects(f.gate.fetch('/api/states/all'), /offline/);
    else assert.equal((await f.gate.fetch('/api/states/all')).status, 200);
    const state = JSON.parse(
      readFileSync(join(f.options.directory, 'states-quota.json')),
    );
    assert.equal(state.inFlight, undefined);
    f.tick(1000);
    assert.equal(f.gate.waitMs(), 0);
    assert.throws(
      () =>
        readFileSync(join(f.options.directory, 'states-quota.json.uncertain')),
      { code: 'ENOENT' },
    );
  });
}
