import test from 'node:test';
import assert from 'node:assert/strict';

import {
  probeVoiceProvider,
  probeVoiceProvidersCached,
  resetVoiceProviderProbeCache,
} from './voiceProviderProbe.js';

function respondWith(status) {
  return async () => ({ status, body: { cancel: async () => {} } });
}

test('a 503 means the server has no credential for that provider', async () => {
  // The route answers "DASHSCOPE_API_KEY is not set" this way, and that is the
  // case the picker has to avoid opening on.
  assert.equal(
    await probeVoiceProvider('dashscope', { fetchImpl: respondWith(503) }),
    false,
  );
});

test('a 200 means the route minted a credential', async () => {
  assert.equal(
    await probeVoiceProvider('dashscope', { fetchImpl: respondWith(200) }),
    true,
  );
});

test('a 4xx still counts as configured: the route exists and was reached', async () => {
  // Rate limiting answers 429, and an unauthenticated probe can answer 401.
  // Neither says the provider is unconfigured.
  for (const status of [400, 401, 429]) {
    assert.equal(
      await probeVoiceProvider('openai', { fetchImpl: respondWith(status) }),
      true,
      `status ${status}`,
    );
  }
});

test('a network failure is reported as unconfigured, never as a throw', async () => {
  assert.equal(
    await probeVoiceProvider('dashscope', {
      fetchImpl: async () => {
        throw new Error('offline');
      },
    }),
    false,
  );
});

test('a provider with no probe route is left unjudged', async () => {
  // Hiding a working service would be worse than showing an unusable one.
  assert.equal(
    await probeVoiceProvider('not-a-provider', {
      fetchImpl: respondWith(503),
    }),
    true,
  );
});

test('the probe result is cached for the page lifetime', async () => {
  resetVoiceProviderProbeCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { status: 503, body: { cancel: async () => {} } };
  };
  await probeVoiceProvidersCached({ fetchImpl });
  const first = calls;
  await probeVoiceProvidersCached({ fetchImpl });
  assert.equal(calls, first, 'the second call is served from cache');
});

test('a forced probe bypasses the cache', async () => {
  resetVoiceProviderProbeCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { status: 200, body: { cancel: async () => {} } };
  };
  await probeVoiceProvidersCached({ fetchImpl });
  const first = calls;
  await probeVoiceProvidersCached({ fetchImpl, force: true });
  assert.ok(calls > first, 'a forced probe asks again');
});

test('an aborted page does not poison the cache', async () => {
  resetVoiceProviderProbeCache();
  const controller = new AbortController();
  controller.abort();
  const fetchImpl = async () => ({
    status: 200,
    body: { cancel: async () => {} },
  });
  await probeVoiceProvidersCached({ fetchImpl, signal: controller.signal });
  // The next start must probe for itself rather than inherit the abort.
  let calls = 0;
  await probeVoiceProvidersCached({
    fetchImpl: async () => {
      calls += 1;
      return { status: 200, body: { cancel: async () => {} } };
    },
  });
  assert.ok(calls > 0);
});
