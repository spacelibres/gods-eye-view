import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdsbQuota, ADSB_DAY_MS } from './adsb-quota.js';

function fixture(t, reply = () => Response.json({ ac: [] })) {
  const dir = mkdtempSync(join(tmpdir(), 'gev-adsb-quota-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let clock = 1_800_000_000_000;
  let calls = 0;
  const options = {
    stateFile: join(dir, 'quota.json'),
    now: () => clock,
    militaryIntervalMs: 1000,
    fetchImpl: async () => {
      calls++;
      return reply();
    },
  };
  return {
    options,
    gate: createAdsbQuota(options),
    advance: (n) => {
      clock += n;
    },
    get calls() {
      return calls;
    },
  };
}

test('all consumers and instances share durable short and daily budgets', async (t) => {
  const f = fixture(t);
  const other = createAdsbQuota(f.options);
  for (let i = 0; i < 140; i++) {
    assert.equal((await f.gate.fetch('/v2/lat/1/lon/2/dist/250')).status, 200);
    assert.equal((await other.fetch('/v2/mil', {}, 'military')).status, 429);
    f.advance(1000);
  }
  assert.equal(
    (await other.fetch('/v2/lat/1/lon/2/dist/250')).status,
    429,
    'ancillary cannot consume military reserve',
  );
  for (let i = 0; i < 360; i++) {
    assert.equal((await other.fetch('/v2/mil', {}, 'military')).status, 200);
    f.advance(1000);
  }
  assert.equal(
    (await createAdsbQuota(f.options).fetch('/v2/mil', {}, 'military')).status,
    429,
  );
  assert.equal(f.calls, 500);
  f.advance(ADSB_DAY_MS);
  assert.equal((await f.gate.fetch('/v2/mil', {}, 'military')).status, 200);
});

test('a 429 without a reset blocks every consumer across restart for 24 hours', async (t) => {
  const f = fixture(t, () => new Response('', { status: 429 }));
  assert.equal((await f.gate.fetch('/v2/mil', {}, 'military')).status, 429);
  f.advance(ADSB_DAY_MS - 1);
  const blocked = await createAdsbQuota(f.options).fetch(
    '/v2/lat/1/lon/2/dist/250',
  );
  assert.equal(blocked.status, 429);
  assert.equal(f.calls, 1);
  f.advance(1);
  await f.gate.fetch('/v2/mil', {}, 'military');
  assert.equal(f.calls, 2);
});

test('long Retry-After is never truncated and remaining zero blocks successful responses too', async (t) => {
  const f = fixture(
    t,
    () =>
      new Response('', { status: 429, headers: { 'Retry-After': '172800' } }),
  );
  await f.gate.fetch('/v2/mil', {}, 'military');
  f.advance(ADSB_DAY_MS);
  assert.equal(
    (await createAdsbQuota(f.options).fetch('/v2/mil', {}, 'military')).status,
    429,
  );
  assert.equal(f.calls, 1);
  const g = fixture(t, () =>
    Response.json(
      { ac: [] },
      { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '600' } },
    ),
  );
  await g.gate.fetch('/v2/mil', {}, 'military');
  g.advance(599000);
  await g.gate.fetch('/v2/lat/1/lon/2/dist/250');
  assert.equal(g.calls, 1);
  g.advance(1000);
  await g.gate.fetch('/v2/mil', {}, 'military');
  assert.equal(g.calls, 2);
});

test('failed transport attempts stay charged and broken state fails closed', async (t) => {
  const f = fixture(t, () => {
    throw Error('offline');
  });
  await assert.rejects(f.gate.fetch('/v2/mil', {}, 'military'), /offline/);
  assert.equal(
    (await createAdsbQuota(f.options).fetch('/v2/mil', {}, 'military')).status,
    429,
  );
  writeFileSync(f.options.stateFile, '{broken');
  f.advance(1000);
  assert.equal((await f.gate.fetch('/v2/mil', {}, 'military')).status, 503);
  assert.equal(f.calls, 1);
});

test('the quota gate cannot send credentials or redirects to other origins', async (t) => {
  const f = fixture(t);
  await assert.rejects(f.gate.fetch('https://example.com/v2/mil'), /origin/);
  assert.equal(f.calls, 0);
});

test('military reservations preserve four-minute cadence across processes and restarts', async (t) => {
  const f = fixture(t);
  const options = { ...f.options, militaryIntervalMs: 240000 };
  await createAdsbQuota(options).fetch('/v2/mil', {}, 'military');
  f.advance(1000);
  assert.equal(createAdsbQuota(options).waitMs('military'), 239000);
  assert.equal(
    (await createAdsbQuota(options).fetch('/v2/mil', {}, 'military')).status,
    429,
  );
  assert.equal(
    (await createAdsbQuota(options).fetch('/v2/lat/1/lon/2/dist/250')).status,
    200,
  );
});

test('positive upstream remaining credits constrain future reservations too', async (t) => {
  const f = fixture(t, () =>
    Response.json({ ac: [] }, { headers: { 'x-ratelimit-remaining': '2' } }),
  );
  for (let i = 0; i < 3; i++) {
    await f.gate.fetch('/v2/mil', {}, 'military');
    f.advance(1000);
  }
  assert.equal(
    (await createAdsbQuota(f.options).fetch('/v2/mil', {}, 'military')).status,
    429,
  );
  assert.equal(
    f.calls,
    3,
    'old or out-of-order headers cannot replenish reserved quota',
  );
});

test('a short Retry-After cannot turn an unknown daily reset into a retry loop', async (t) => {
  const f = fixture(
    t,
    () => new Response('', { status: 429, headers: { 'Retry-After': '30' } }),
  );
  await f.gate.fetch('/v2/mil', {}, 'military');
  f.advance(30000);
  assert.equal(
    (await createAdsbQuota(f.options).fetch('/v2/lat/1/lon/2/dist/250')).status,
    429,
  );
  assert.equal(f.calls, 1);
});

test('a cross-process lock collision cannot lose an observed vendor cooldown', async (t) => {
  let stateFile;
  const f = fixture(t, () => {
    writeFileSync(stateFile + '.lock', 'foreign transaction');
    return new Response('', { status: 429 });
  });
  stateFile = f.options.stateFile;
  assert.equal((await f.gate.fetch('/v2/mil', {}, 'military')).status, 503);
  rmSync(stateFile + '.lock');
  f.advance(1000);
  assert.equal(
    (await createAdsbQuota(f.options).fetch('/v2/lat/1/lon/2/dist/250')).status,
    503,
  );
  assert.equal(f.calls, 1);
});

test('unfinished requests survive restarts and serialize remaining-credit decisions', async (t) => {
  let release;
  const f = fixture(
    t,
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const a = f.gate.fetch('/v2/mil', {}, 'military');
  f.advance(1000);
  const b = await createAdsbQuota(f.options).fetch('/v2/lat/1/lon/2/dist/250');
  assert.equal(
    b.status,
    429,
    'second process cannot consume unconfirmed allowance',
  );
  assert.equal(f.calls, 1);
  release(
    Response.json({ ac: [] }, { headers: { 'x-ratelimit-remaining': '1' } }),
  );
  await a;
  f.advance(1000);
  const c = f.gate.fetch('/v2/mil', {}, 'military');
  // The reservation is awaited before the vendor call, so the pending promise
  // for `c` only exists once the request has reached the transport.
  while (f.calls < 2) await new Promise((resolve) => setImmediate(resolve));
  release(
    Response.json({ ac: [] }, { headers: { 'x-ratelimit-remaining': '1' } }),
  );
  await c;
  f.advance(1000);
  assert.equal(
    (await createAdsbQuota(f.options).fetch('/v2/mil', {}, 'military')).status,
    429,
  );
  assert.equal(f.calls, 2);
});

test('a crashed transport exposes the full unresolved quota window instead of one-second retries', (t) => {
  const f = fixture(t);
  const at = 1800000000000;
  writeFileSync(
    f.options.stateFile,
    JSON.stringify({
      version: 1,
      attempts: [{ at, kind: 'military' }],
      inFlight: at,
      holdUntil: 0,
    }),
  );
  f.advance(13000);
  assert.equal(
    createAdsbQuota(f.options).waitMs('military'),
    ADSB_DAY_MS - 13000,
  );
});

test('a ledger lock held for a short transaction is waited for, not reported as unavailable', async (t) => {
  const f = fixture(t);
  const lock = f.options.stateFile + '.lock';
  writeFileSync(lock, '');
  setTimeout(() => rmSync(lock, { force: true }), 150);
  const response = await f.gate.fetch('/v2/lat/1/lon/2/dist/250');
  assert.equal(response.status, 200);
  assert.equal(f.calls, 1);
});

test('a ledger lock that is never released still fails closed', async (t) => {
  const f = fixture(t);
  writeFileSync(f.options.stateFile + '.lock', '');
  const response = await f.gate.fetch('/v2/lat/1/lon/2/dist/250');
  assert.equal(response.status, 503);
  assert.equal(f.calls, 0);
});
