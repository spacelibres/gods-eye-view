import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSkyProxy } from './opensky.js';
import { createOpenSkyQuota } from './opensky-quota.js';
import { createFlightSource } from '../../../src/sources/live/standalone.js';

test('many real HTTP clients read one VPS snapshot without spending another OpenSky credit', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'gev-opensky-http-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let upstream = 0;
  const quota = createOpenSkyQuota({
    directory,
    fetchImpl: async () => {
      upstream++;
      return Response.json(
        { time: Date.now() / 1000, states: [] },
        { headers: { 'X-Rate-Limit-Remaining': '3996' } },
      );
    },
  });
  const plugin = openSkyProxy({
    directory,
    quota,
    authMode: 'oauth',
    tokenProvider: async () => 'fixture',
  });
  const server = createServer();
  plugin.configureServer({
    httpServer: server,
    middlewares: {
      use: (_path, fn) => {
        server.on('request', (req, res) => {
          req.url = '/';
          fn(req, res, () => {});
        });
      },
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await plugin.ready();
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const r of await Promise.all(
    Array.from({ length: 40 }, () => fetch(origin + '/api/flights')),
  )) {
    assert.equal(r.status, 200);
    await r.json();
  }
  let clientRequests = 0;
  const fetchImpl = (_url, options) => {
    clientRequests++;
    return fetch(origin + '/api/flights', options);
  };
  const a = createFlightSource({ fetchImpl }),
    b = createFlightSource({ fetchImpl });
  await Promise.all([
    a.getSnapshot({ latitude: 1, longitude: 1 }),
    b.getSnapshot({ latitude: 30, longitude: -97 }),
  ]);
  await a.getSnapshot();
  assert.equal(clientRequests, 1);
  assert.equal(upstream, 1);
  const ledger = JSON.parse(
    readFileSync(join(directory, 'states-quota.json'), 'utf8'),
  );
  assert.equal(ledger.attempts.length, 1);
  assert.equal(ledger.attempts[0].cost, 4);
});
