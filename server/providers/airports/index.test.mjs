import test from 'node:test';
import assert from 'node:assert/strict';
import { airportsProxy } from './index.js';
const airport = {
  id: '1',
  ident: 'X',
  name: 'Airport',
  type: 'large_airport',
  lat: 1,
  lon: 1,
  elevationM: null,
  countryCode: 'NA',
  country: 'Namibia',
  regionCode: '',
  region: '',
  municipality: '',
  icaoCode: '',
  iataCode: '',
  gpsCode: '',
  localCode: '',
  scheduledService: false,
  keywords: '',
  website: '',
  wikipedia: '',
};
const snapshot = {
  schemaVersion: 1,
  revision: 'a'.repeat(40),
  updatedAt: '2026-10-21T00:00:00Z',
  source: 'OurAirports',
  sourceUrl: 'https://ourairports.com/data/',
  records: [airport],
};
test('cache-only middleware serves search detail bounds and proper errors', async () => {
  let reads = 0;
  const collector = {
    ready: Promise.resolve(),
    getSnapshot: () => snapshot,
    close: async () => {},
  };
  const plugin = airportsProxy({ collector });
  let middleware;
  plugin.configureServer({
    middlewares: {
      use(fn) {
        middleware = fn;
      },
    },
    httpServer: { once() {} },
  });
  await plugin.ready;
  async function request(url, method = 'GET') {
    let status, body;
    const res = {
      setHeader() {},
      end(v) {
        body = JSON.parse(v);
      },
      set statusCode(n) {
        status = n;
      },
    };
    await middleware({ url, method }, res, () => {
      reads++;
    });
    return { status, body };
  }
  assert.equal(
    (await request('/api/airports/detail?id=1')).body.airport.id,
    '1',
  );
  assert.equal(
    (await request('/api/airports/search?q=Airport')).body.matched,
    1,
  );
  assert.equal((await request('/api/airports/navaids')).status, 503);
  assert.equal((await request('/api/airports/countries')).status, 503);
  snapshot.countries = [
    {
      code: 'NA',
      name: 'Namibia',
      continent: 'AF',
      wikipedia: '',
      keywords: '',
    },
  ];
  snapshot.navaids = [];
  assert.equal(
    (await request('/api/airports/countries')).body.countries[0].name,
    'Namibia',
  );
  assert.equal((await request('/api/airports/navaids')).body.total, 0);
  assert.equal((await request('/api/airports/navaids?type=BAD')).status, 400);
  assert.equal((await request('/api/airports?limit=0')).status, 400);
  assert.equal((await request('/api/airports/detail?id=missing')).status, 404);
  assert.equal((await request('/api/airports', 'POST')).status, 405);
  await request('/api/airports-extra');
  assert.equal(reads, 1);
  await plugin.closeBundle();
});

test('local provenance and source downloads never invoke collection', async () => {
  let middleware,
    collections = 0;
  const calls = [];
  const collector = {
    ready: Promise.resolve(),
    getSnapshot: () => snapshot,
    getProvenance: () => ({
      revision: snapshot.revision,
      files: { 'runways.csv': { bytes: 8, sha256: 'abc' } },
    }),
    readSourceFile: async (name) => {
      calls.push(name);
      return Buffer.from('id\n123\n');
    },
    refresh: () => collections++,
    close: async () => {},
  };
  const proxy = airportsProxy({ collector });
  proxy.configureServer({
    middlewares: {
      use(fn) {
        middleware = fn;
      },
    },
    httpServer: { once() {} },
  });
  await proxy.ready;
  async function request(url) {
    const headers = {};
    let body, status;
    await middleware(
      { url, method: 'GET' },
      {
        setHeader(k, v) {
          headers[k] = v;
        },
        set statusCode(n) {
          status = n;
        },
        end(value) {
          body = value;
        },
      },
      () => {
        status = 404;
      },
    );
    return { headers, status, body };
  }
  const info = await request('/api/airports/provenance');
  assert.equal(info.status, 200);
  assert.equal(
    JSON.parse(info.body).files['runways.csv'].url.startsWith(
      '/api/airports/files/',
    ),
    true,
  );
  const csv = await request('/api/airports/files/runways.csv');
  assert.equal(csv.status, 200);
  assert.equal(csv.body.toString(), 'id\n123\n');
  assert.match(csv.headers['Content-Type'], /text\/csv/);
  const invalid = await request('/api/airports/files/secrets.csv');
  assert.equal(invalid.status, 404);
  assert.deepEqual(calls, ['runways.csv']);
  assert.equal(collections, 0);
  await proxy.closeBundle();
});
