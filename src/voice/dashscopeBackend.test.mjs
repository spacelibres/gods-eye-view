import test from 'node:test';
import assert from 'node:assert/strict';

import { createDashScopeBackend } from './dashscopeBackend.js';

/** A socket stand-in that lets the test drive its lifecycle. */
function fakeSocket() {
  const listeners = new Map();
  const sent = [];
  return {
    sent,
    send: (data) => sent.push(data),
    close() {
      this.closed = true;
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      const list = listeners.get(type) ?? [];
      const at = list.indexOf(handler);
      if (at >= 0) list.splice(at, 1);
    },
    emit(type) {
      for (const handler of [...(listeners.get(type) ?? [])]) handler();
    },
  };
}

/** A fetch stand-in returning one canned JSON response. */
function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    json: async () => body,
  };
}

test('a token mint is unwrapped into the credential the socket needs', async () => {
  const backend = createDashScopeBackend({
    tokenTransport: async () =>
      jsonResponse(
        { value: 'st-lt-test', expires_at: Math.floor(Date.now() / 1000) + 600, session: { model: 'qwen3-omni-flash-realtime' } },
        { headers: { 'X-GEV-Voice-Model': 'qwen3-omni-flash-realtime' } },
      ),
  });
  const minted = await backend.requestToken({ tier: 'standard' });
  assert.equal(minted.token, 'st-lt-test');
  assert.equal(minted.model, 'qwen3-omni-flash-realtime');
});

test('a missing server key is reported by name, not as a generic failure', async () => {
  const backend = createDashScopeBackend({
    tokenTransport: async () =>
      jsonResponse({ error: 'DASHSCOPE_API_KEY is not set' }, { status: 503 }),
  });
  await assert.rejects(
    () => backend.requestToken({}),
    /DASHSCOPE_API_KEY is not set/,
  );
});

test('an expired token is refused before it reaches the socket', async () => {
  const backend = createDashScopeBackend({
    tokenTransport: async () =>
      jsonResponse({ value: 'st-lt-old', expires_at: 1 }, { status: 200 }),
  });
  await assert.rejects(() => backend.requestToken({}), /expired/);
});

test('the account key never travels with the socket: the token is a header', async () => {
  const socket = fakeSocket();
  let openedWith = null;
  const backend = createDashScopeBackend({
    WebSocketImpl: (url, options) => {
      openedWith = { url, options };
      return socket;
    },
  });
  const pending = backend.openSocket({
    credential: { token: 'st-lt-test' },
    model: 'qwen3-omni-flash-realtime',
  });
  socket.emit('open');
  await pending;
  assert.match(openedWith.url, /^wss:\/\//);
  assert.match(openedWith.url, /model=qwen3-omni-flash-realtime/);
  // A token in the query string would land in proxy logs and page history.
  assert.doesNotMatch(openedWith.url, /st-lt-test/);
  assert.equal(
    openedWith.options.headers.Authorization,
    'Bearer st-lt-test',
  );
});

test('a socket that errors rejects instead of hanging the session', async () => {
  const socket = fakeSocket();
  const backend = createDashScopeBackend({
    WebSocketImpl: () => socket,
  });
  const pending = backend.openSocket({ credential: { token: 'x' } });
  socket.emit('error');
  await assert.rejects(() => pending, /failed to open/);
});

test('an aborted connect closes the socket and rejects', async () => {
  const socket = fakeSocket();
  const backend = createDashScopeBackend({ WebSocketImpl: () => socket });
  const controller = new AbortController();
  const pending = backend.openSocket({
    credential: { token: 'x' },
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(() => pending, /aborted/);
  assert.equal(socket.closed, true);
});

test('audio is appended as the vendor event, base64 untouched', async () => {
  const socket = fakeSocket();
  const backend = createDashScopeBackend({ WebSocketImpl: () => socket });
  backend.appendAudio(socket, 'AAECAw==');
  const sent = JSON.parse(socket.sent[0]);
  assert.equal(sent.type, 'input_audio_buffer.append');
  assert.equal(sent.audio, 'AAECAw==');
  assert.ok(sent.event_id, 'every event carries an id');
});

test('the backend advertises its own protocol and transport', () => {
  const backend = createDashScopeBackend();
  assert.equal(backend.protocol, 'dashscope-realtime');
  assert.equal(backend.transport, 'websocket');
  // There is no SDP handshake in this transport; exposing one would invite a
  // caller to run the WebRTC path against a WebSocket.
  assert.equal(backend.negotiate, undefined);
});
