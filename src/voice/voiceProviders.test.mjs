import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_VOICE_PROVIDER,
  VOICE_PROVIDERS,
  VOICE_PROVIDER_STORAGE_KEY,
  createVoiceBackend,
  findVoiceProvider,
  readStoredVoiceProvider,
  resolveVoiceProvider,
  storeVoiceProvider,
} from './voiceProviders.js';

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

test('only providers the page can actually run are offered', () => {
  // realtimeConnection.js refuses to start without RTCPeerConnection, so a
  // websocket provider listed today would be a picker entry that cannot
  // connect. This fails the day one is added without its transport work.
  for (const provider of VOICE_PROVIDERS) {
    assert.equal(
      provider.transport,
      'webrtc',
      `${provider.id} needs a transport realtimeConnection can drive`,
    );
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
