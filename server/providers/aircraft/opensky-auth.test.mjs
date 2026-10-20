import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenSkyAuth } from './opensky-auth.js';

test('OAuth consumers coalesce and reuse one token until its real expiry', async () => {
  let at = 1800000000000,
    calls = 0;
  const auth = createOpenSkyAuth({
    now: () => at,
    environment: () => ({
      OPENSKY_CLIENT_ID: 'fixture',
      OPENSKY_CLIENT_SECRET: 'secret',
    }),
    fetchImpl: async (_url, options) => {
      calls++;
      assert.equal(
        new URLSearchParams(options.body).get('grant_type'),
        'client_credentials',
      );
      assert.equal(options.redirect, 'error');
      return Response.json({ access_token: 'token' + calls, expires_in: 1800 });
    },
  });
  assert.deepEqual(await Promise.all([auth.getToken(), auth.getToken()]), [
    'token1',
    'token1',
  ]);
  assert.equal(calls, 1);
  at += 1740000;
  assert.equal(await auth.getToken(), 'token2');
  auth.invalidate();
  assert.equal(await auth.getToken(), 'token3');
});

test('missing credentials and expired token replies fail without exposing secrets', async () => {
  const missing = createOpenSkyAuth({
    environment: () => ({}),
    fetchImpl: () => {
      throw Error('must not connect');
    },
  });
  assert.equal(await missing.getToken(), null);
  const bad = createOpenSkyAuth({
    environment: () => ({ OPENSKY_CLIENT_ID: 'x', OPENSKY_CLIENT_SECRET: 'y' }),
    fetchImpl: async () =>
      Response.json({ access_token: 'expired', expires_in: 0 }),
  });
  assert.equal(await bad.getToken(), null);
});
