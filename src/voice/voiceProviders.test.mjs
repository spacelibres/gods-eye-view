import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_VOICE_PROVIDER,
  PENDING_VOICE_PROVIDERS,
  VOICE_PROVIDERS,
  VOICE_PROVIDER_STORAGE_KEY,
  createVoiceBackend,
  findVoiceProvider,
  readStoredVoiceProvider,
  resolveVoiceProvider,
  storeVoiceProvider,
} from './voiceProviders.js';
import {
  VOICE_PROVIDER_SPECS,
  findVoiceProviderSpec,
  providerEnvKeys,
  supportsBargeIn,
} from './voiceProviderSpecs.js';

/** A storage stand-in with the two methods the registry uses. */
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, value),
    data,
  };
}

test('every provider is complete enough to select', () => {
  assert.ok(VOICE_PROVIDERS.length >= 1);
  for (const provider of VOICE_PROVIDERS) {
    assert.ok(provider.id, 'has an id');
    assert.ok(provider.label, `${provider.id} has a label`);
    assert.ok(
      provider.transport === 'webrtc' || provider.transport === 'websocket',
      `${provider.id} declares a known transport`,
    );
    assert.equal(typeof provider.create, 'function', `${provider.id} creates`);
  }
});

test('provider ids are unique', () => {
  const ids = VOICE_PROVIDERS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('the default provider exists, so the fallback can never dangle', () => {
  assert.ok(findVoiceProvider(DEFAULT_VOICE_PROVIDER));
});

test('only providers the page can actually run are selectable', () => {
  // Every selectable provider must expose a connect path realtimeConnection can
  // drive. OpenAI does it with WebRTC; DashScope with a WebSocket the adapter
  // opens itself. A provider listed without either would be a picker entry
  // that connects to nothing.
  for (const provider of VOICE_PROVIDERS) {
    const backend = provider.create();
    const canConnect =
      typeof backend.negotiate === 'function' ||
      typeof backend.openSocket === 'function';
    assert.ok(
      canConnect,
      `${provider.id} has no way to connect (needs negotiate or openSocket)`,
    );
  }
});

test('OpenAI and DashScope are selectable; the rest are pending', () => {
  const selectable = VOICE_PROVIDERS.map((p) => p.id).sort();
  assert.deepEqual(selectable, ['dashscope', 'openai']);
  assert.deepEqual([...PENDING_VOICE_PROVIDERS].sort(), [
    'baidu',
    'doubao',
    'tencent',
    'xfyun',
  ]);
});

test('a specified provider without an adapter is reported as pending', () => {
  for (const id of PENDING_VOICE_PROVIDERS) {
    assert.equal(
      findVoiceProvider(id),
      null,
      `${id} is pending, so the picker must not offer it`,
    );
  }
});

test('every spec names the environment variables its server side needs', () => {
  for (const spec of VOICE_PROVIDER_SPECS) {
    assert.ok(spec.envKeys.length > 0, `${spec.id} names its env keys`);
    for (const key of spec.envKeys) {
      assert.match(key, /^[A-Z0-9_]+$/, `${spec.id}: ${key} looks like an env var`);
    }
  }
  assert.deepEqual(providerEnvKeys('openai'), ['OPENAI_API_KEY']);
  assert.deepEqual(providerEnvKeys('nope'), []);
});

test('audio rates are stated per vendor, because they differ', () => {
  // Guessing these produces audio that plays at the wrong speed, so each spec
  // has to carry its own numbers rather than inherit one default.
  const rates = new Set(
    VOICE_PROVIDER_SPECS.map((s) => `${s.audio.inputHz}/${s.audio.outputHz}`),
  );
  assert.ok(rates.size > 1, 'the vendors do not share one audio format');
  for (const spec of VOICE_PROVIDER_SPECS) {
    assert.ok(Number.isInteger(spec.audio.inputHz));
    assert.ok(Number.isInteger(spec.audio.outputHz));
  }
});

test('a one-shot provider is marked as unable to barge in', () => {
  assert.equal(supportsBargeIn('baidu'), false);
  assert.equal(supportsBargeIn('openai'), true);
  assert.equal(supportsBargeIn('dashscope'), true);
});

test('every spec cites the documentation its values came from', () => {
  for (const spec of VOICE_PROVIDER_SPECS) {
    assert.match(spec.docs, /^https:\/\//, `${spec.id} cites docs`);
  }
});

test('an unknown stored choice falls back instead of failing', () => {
  assert.equal(findVoiceProvider('nope'), null);
  assert.equal(resolveVoiceProvider('nope').id, DEFAULT_VOICE_PROVIDER);
  assert.equal(resolveVoiceProvider('').id, DEFAULT_VOICE_PROVIDER);
  assert.equal(resolveVoiceProvider(undefined).id, DEFAULT_VOICE_PROVIDER);
});

test('a stored choice is read back', () => {
  const storage = memoryStorage({
    [VOICE_PROVIDER_STORAGE_KEY]: DEFAULT_VOICE_PROVIDER,
  });
  assert.equal(readStoredVoiceProvider(storage).id, DEFAULT_VOICE_PROVIDER);
});

test('a stored choice that no longer exists still yields a usable provider', () => {
  const storage = memoryStorage({ [VOICE_PROVIDER_STORAGE_KEY]: 'retired' });
  assert.equal(readStoredVoiceProvider(storage).id, DEFAULT_VOICE_PROVIDER);
});

test('storage that throws does not take the voice UI down with it', () => {
  const hostile = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
  };
  assert.equal(readStoredVoiceProvider(hostile).id, DEFAULT_VOICE_PROVIDER);
  assert.equal(storeVoiceProvider(DEFAULT_VOICE_PROVIDER, hostile), false);
});

test('storing refuses an id that names no provider', () => {
  const storage = memoryStorage();
  assert.equal(storeVoiceProvider('made-up', storage), false);
  assert.equal(storage.data.size, 0);
});

test('storing a real provider persists it', () => {
  const storage = memoryStorage();
  assert.equal(storeVoiceProvider(DEFAULT_VOICE_PROVIDER, storage), true);
  assert.equal(
    storage.data.get(VOICE_PROVIDER_STORAGE_KEY),
    DEFAULT_VOICE_PROVIDER,
  );
});

test('the built backend names the provider that was selected', () => {
  const { provider, backend } = createVoiceBackend(DEFAULT_VOICE_PROVIDER);
  assert.equal(provider.id, DEFAULT_VOICE_PROVIDER);
  assert.equal(backend.providerId, DEFAULT_VOICE_PROVIDER);
  // The contract the controller drives, unchanged from the OpenAI path.
  assert.equal(typeof backend.requestToken, 'function');
  assert.equal(typeof backend.negotiate, 'function');
});
