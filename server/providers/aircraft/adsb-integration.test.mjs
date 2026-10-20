import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { adsbLolProxy } from './adsb-lol.js';
import { createAdsbQuota } from './adsb-quota.js';
import { createMilitarySource } from '../../../src/sources/live/standalone.js';

test('real HTTP clients share VPS collection and cache reads never spend upstream quota', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'gev-adsb-http-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let calls = 0;
  const quota = createAdsbQuota({
    stateFile: join(directory, 'quota.json'),
    fetchImpl: async () => {
      calls++;
      return Response.json({
        now: Date.now() / 1000,
        ac: [{ hex: 'abc123', lat: 30, lon: -97 }],
      });
    },
  });
  const plugin = adsbLolProxy({ quota, directory });
  const server = createServer();
  plugin.configureServer({
    httpServer: server,
    middlewares: {
      use: (_route, handler) => {
        server.on('request', (req, res) => {
          req.url = '/';
          handler(req, res, () => {});
        });
      },
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });
  await plugin.ready();
  const url = `http://127.0.0.1:${server.address().port}/api/military`;
  const responses = await Promise.all(
    Array.from({ length: 40 }, () => fetch(url)),
  );
  for (const response of responses) {
    assert.equal(response.status, 200);
    await response.json();
  }
  let clientReads = 0;
  const fetchImpl = (...args) => {
    clientReads++;
    return fetch(url, args[1]);
  };
  const a = createMilitarySource({ fetchImpl });
  const b = createMilitarySource({ fetchImpl });
  await Promise.all([a.getSnapshot(), b.getIdentities(), a.getSnapshot()]);
  await a.getSnapshot();
  assert.equal(
    clientReads,
    1,
    'separate source owners share the frontend cache',
  );
  assert.equal(calls, 1, 'only the background collector contacts upstream');
  const ledger = JSON.parse(
    readFileSync(join(directory, 'quota.json'), 'utf8'),
  );
  assert.equal(ledger.attempts.length, 1);
  assert.equal(ledger.attempts[0].kind, 'military');
});
