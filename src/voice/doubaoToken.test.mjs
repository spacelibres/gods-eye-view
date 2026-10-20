import test from 'node:test';
import assert from 'node:assert/strict';
import { createDoubaoTokenHandler } from '../../server/providers/doubao/token.js';

test('Doubao credentials remain behind the relay rather than reaching the browser', async () => {
  const handler = createDoubaoTokenHandler({
    resolveAppId: () => 'private-app',
    resolveAccessToken: () => 'private-access',
  });
  let body;
  const res = {
    setHeader() {},
    end(value) {
      body = value;
    },
  };
  await handler(
    { method: 'GET', url: '/api/doubao/token', socket: {}, headers: {} },
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(body, /private-app|private-access/);
  assert.equal(JSON.parse(body).value, 'same-origin-relay');
});
