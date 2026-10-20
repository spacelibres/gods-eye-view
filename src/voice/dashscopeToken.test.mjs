import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DASHSCOPE_REALTIME_MODEL_DEFAULT,
  createDashScopeTokenHandler,
} from '../../server/providers/dashscope/token.js';

/** A minimal response recorder. */
function recorder() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body = '') {
      this.body = body;
    },
  };
}

function request(method = 'GET') {
  return { method, url: '/api/dashscope/token', headers: {}, socket: {} };
}

/** Run a handler with rate limiting off, since it would otherwise share state. */
async function run(handler, req = request()) {
  process.env.GEV_RATELIMIT_OPENAI_PER_MIN = '0';
  const res = recorder();
  await handler(req, res);
  return res;
}

test('a server without the key answers 503 and names the variable', async () => {
  const handler = createDashScopeTokenHandler({ resolveApiKey: () => '' });
  const res = await run(handler);
  assert.equal(res.statusCode, 503);
  // The picker reads this string to tell "not configured" from "broken".
  assert.match(res.body, /DASHSCOPE_API_KEY is not set/);
});

test('the account key is exchanged for a short-lived token', async () => {
  let seen = null;
  const handler = createDashScopeTokenHandler({
    resolveApiKey: () => 'sk-test',
    fetchImpl: async (url, options) => {
      seen = { url, options };
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ token: 'st-lt-abc', expires_at: 1_800_000_000 }),
      };
    },
  });
  const res = await run(handler);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.value, 'st-lt-abc');
  assert.equal(body.expires_at, 1_800_000_000);
  assert.equal(
    res.headers['X-GEV-Voice-Model'],
    DASHSCOPE_REALTIME_MODEL_DEFAULT,
  );
  // The account key is what goes upstream; the page only ever sees the token.
  assert.equal(seen.options.headers.Authorization, 'Bearer sk-test');
  assert.doesNotMatch(res.body, /sk-test/);
});

test('the model can be pinned by the environment', async () => {
  const handler = createDashScopeTokenHandler({
    resolveApiKey: () => 'sk-test',
    environment: { DASHSCOPE_REALTIME_MODEL: 'qwen3.5-omni-plus-realtime' },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ token: 'st-lt', expires_at: 9e12 }),
    }),
  });
  const res = await run(handler);
  assert.equal(res.headers['X-GEV-Voice-Model'], 'qwen3.5-omni-plus-realtime');
});

test('a rejected account key surfaces as 401, not as a generic 500', async () => {
  const handler = createDashScopeTokenHandler({
    resolveApiKey: () => 'sk-bad',
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ code: 'InvalidApiKey' }),
    }),
  });
  const res = await run(handler);
  assert.equal(res.statusCode, 401);
  assert.match(res.body, /Failed to create DashScope token/);
});

test('an upstream that returns junk does not become a bogus credential', async () => {
  const handler = createDashScopeTokenHandler({
    resolveApiKey: () => 'sk-test',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => '<html>oops</html>',
    }),
  });
  const res = await run(handler);
  assert.equal(res.statusCode, 502);
  assert.match(res.body, /unreadable/);
});

test('a 200 without a token is refused rather than passed on', async () => {
  const handler = createDashScopeTokenHandler({
    resolveApiKey: () => 'sk-test',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ expires_at: 9e12 }),
    }),
  });
  const res = await run(handler);
  assert.equal(res.statusCode, 502);
  assert.match(res.body, /no token/);
});

test('only GET and POST are served', async () => {
  const handler = createDashScopeTokenHandler({ resolveApiKey: () => 'sk' });
  const res = await run(handler, request('DELETE'));
  assert.equal(res.statusCode, 405);
});

test('the token response is never cached', async () => {
  const handler = createDashScopeTokenHandler({ resolveApiKey: () => 'sk' });
  const res = await run(handler);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('a minted Qwen session includes the app instructions and tool catalog', async () => {
  const handler = createDashScopeTokenHandler({
    resolveApiKey: () => 'test-key',
    tools: [
      {
        type: 'function',
        name: 'fly_to_location',
        parameters: { type: 'object' },
      },
    ],
    fetchImpl: async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({ token: 'temporary', expires_at: 1800000000 }),
    }),
  });
  const res = await run(handler);
  const session = JSON.parse(res.body).session;
  assert.match(session.instructions, /GEV Voice Control/);
  assert.equal(session.tools[0].name, 'fly_to_location');
});
