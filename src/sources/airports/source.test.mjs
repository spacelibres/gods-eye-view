import test from 'node:test';
import assert from 'node:assert/strict';
import { createAirportSource } from './source.js';
export const airport = {
  id: '2434',
  ident: 'EGLL',
  name: 'London Heathrow Airport',
  type: 'large_airport',
  lat: 51.47,
  lon: -0.46,
  elevationM: 25,
  countryCode: 'GB',
  country: 'United Kingdom',
  regionCode: 'GB-ENG',
  region: 'England',
  municipality: 'London',
  icaoCode: 'EGLL',
  iataCode: 'LHR',
  gpsCode: 'EGLL',
  localCode: '',
  scheduledService: true,
  keywords: '',
  website: '',
  wikipedia: '',
};
export const list = {
  revision: 'abc',
  updatedAt: '2026-10-20T00:00:00Z',
  source: 'OurAirports',
  sourceUrl: 'https://ourairports.com/data/',
  total: 1,
  matched: 1,
  truncated: false,
  airports: [airport],
};
test('airport reads build bounded URLs, cache briefly and validate detail', async () => {
  let calls = [];
  let time = 0;
  const source = createAirportSource({
    now: () => time,
    fetchImpl: async (url) => {
      calls.push(url);
      return Response.json(
        url.includes('/detail') ? { ...list, airport } : list,
      );
    },
  });
  await source.getSnapshot({
    bounds: { west: 170, south: -90, east: -170, north: 90 },
    types: ['large_airport'],
    limit: 5000,
  });
  assert.match(calls[0], /limit=2000/);
  assert.match(calls[0], /west=170/);
  await source.search('EGLL');
  await source.search('EGLL');
  assert.equal(calls.length, 2);
  time = 60001;
  await source.search('EGLL');
  assert.equal(calls.length, 3);
  assert.equal((await source.getAirport('2434')).airport.id, '2434');
});
test('coalesced consumers abort independently; final abort cancels upstream', async () => {
  let count = 0,
    upstream;
  let finish;
  const source = createAirportSource({
    fetchImpl: (_url, { signal }) => {
      count++;
      upstream = signal;
      return new Promise(
        (resolve) => (finish = () => resolve(Response.json(list))),
      );
    },
  });
  const a = new AbortController(),
    b = new AbortController();
  const first = source.search('LHR', { signal: a.signal });
  const second = source.search('LHR', { signal: b.signal });
  a.abort();
  await assert.rejects(first, { name: 'AbortError' });
  assert.equal(upstream.aborted, false);
  finish();
  assert.equal((await second).airports.length, 1);
  assert.equal(count, 1);
  const c = new AbortController(),
    d = new AbortController();
  const third = source.search('EGLL', { signal: c.signal }),
    fourth = source.search('EGLL', { signal: d.signal });
  c.abort();
  d.abort();
  await Promise.all([
    assert.rejects(third, { name: 'AbortError' }),
    assert.rejects(fourth, { name: 'AbortError' }),
  ]);
  assert.equal(upstream.aborted, true);
});
test('HTTP, malformed and oversized responses reject and remain retryable', async () => {
  for (const response of [
    new Response('', { status: 503 }),
    Response.json({ ...list, airports: [{ ...airport, lat: null }] }),
    Response.json({ ...list, matched: 0 }),
    new Response('{}', { headers: { 'content-length': '9000000' } }),
  ]) {
    let count = 0;
    const source = createAirportSource({
      fetchImpl: async () => (++count === 1 ? response : Response.json(list)),
    });
    await assert.rejects(source.search('LHR'));
    assert.equal((await source.search('LHR')).matched, 1);
  }
});

test(
  'deadline bounds stalled headers and bodies and releases the same query for retry',
  { timeout: 250 },
  async () => {
    for (const stall of ['headers', 'body']) {
      let count = 0,
        upstream,
        cancelled = false;
      const source = createAirportSource({
        timeoutMs: 15,
        fetchImpl: async (_url, { signal }) => {
          upstream = signal;
          if (++count > 1) return Response.json(list);
          return stall === 'headers'
            ? new Promise(() => {})
            : new Response(
                new ReadableStream({
                  start(controller) {
                    controller.enqueue(new TextEncoder().encode('{'));
                  },
                  cancel() {
                    cancelled = true;
                  },
                }),
              );
        },
      });
      const first = source.search('LHR'),
        second = source.search('LHR');
      await Promise.all([
        assert.rejects(first, { name: 'TimeoutError' }),
        assert.rejects(second, { name: 'TimeoutError' }),
      ]);
      assert.equal(upstream.aborted, true);
      if (stall === 'body') assert.equal(cancelled, true);
      assert.equal((await source.search('LHR')).airports.length, 1);
      assert.equal(count, 2);
    }
  },
);
