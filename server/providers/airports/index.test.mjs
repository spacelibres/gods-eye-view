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
  assert.equal((await request('/api/airports?limit=0')).status, 400);
  assert.equal((await request('/api/airports/detail?id=missing')).status, 404);
  assert.equal((await request('/api/airports', 'POST')).status, 405);
  await request('/api/airports-extra');
  assert.equal(reads, 1);
  await plugin.closeBundle();
});
