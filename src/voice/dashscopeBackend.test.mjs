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
        {
          value: 'st-lt-test',
          expires_at: Math.floor(Date.now() / 1000) + 600,
          session: { model: 'qwen3-omni-flash-realtime' },
        },
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

test('browser sockets use the same-origin relay without unsupported auth options', async () => {
  const socket = fakeSocket();
  let openedWith = null;
  const backend = createDashScopeBackend({
    origin: 'https://globe.example',
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
  assert.equal(openedWith.url, 'wss://globe.example/api/dashscope/socket');
  // A token in the query string would land in proxy logs and page history.
  assert.doesNotMatch(openedWith.url, /st-lt-test/);
  assert.equal(openedWith.options, undefined);
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

test('Qwen session config registers shared tools without unsupported flags', () => {
  const socket = fakeSocket();
  const backend = createDashScopeBackend();
  backend.configureSession(socket, {
    session: {
      model: 'chosen-model',
      instructions: 'control the globe',
      tools: [
        {
          type: 'function',
          name: 'fly_to_location',
          parameters: { type: 'object' },
        },
      ],
      tool_choice: 'auto',
    },
  });
  const event = JSON.parse(socket.sent[0]);
  assert.equal(event.type, 'session.update');
  assert.equal(event.session.instructions, 'control the globe');
  assert.equal(event.session.tools[0].function.name, 'fly_to_location');
  assert.equal(event.session.tool_choice, undefined);
  assert.equal(event.session.model, undefined);
});

test('Qwen follow-ups adapt response instructions and restore the session for new speech', () => {
  const socket = fakeSocket();
  const backend = createDashScopeBackend();
  backend.configureSession(socket, {
    session: { instructions: 'base app policy', tools: [] },
  });
  backend.sendEvent(socket, {
    type: 'response.create',
    response: { instructions: 'confirm actual result', tool_choice: 'none' },
  });
  const sent = socket.sent.map(JSON.parse);
  assert.match(
    sent.at(-2).session.instructions,
    /base app policy\nconfirm actual result/,
  );
  assert.equal(sent.at(-1).response, undefined);
  backend.observeEvent(socket, { type: 'input_audio_buffer.speech_started' });
  assert.equal(
    JSON.parse(socket.sent.at(-1)).session.instructions,
    'base app policy',
  );
});

test('Qwen viewport analysis preserves text and deletes the actual retained snapshot', async () => {
  const socket = fakeSocket();
  let resolve;
  const bodies = [];
  const backend = createDashScopeBackend({
    visionTransport: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      await new Promise((done) => {
        resolve = done;
      });
      return Response.json({
        message: { role: 'assistant', content: 'A visible airport' },
      });
    },
  });
  backend.configureSession(socket, {
    session: { instructions: 'base app policy', tools: [] },
  });
  backend.sendEvent(socket, {
    type: 'conversation.item.create',
    item: {
      id: 'current-image',
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: 'Current camera and pointer context' },
        { type: 'input_image', image_url: 'data:image/jpeg;base64,AAAA' },
      ],
    },
  });
  backend.sendEvent(socket, { type: 'response.create' });
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(bodies.length, 1);
  assert.equal(
    bodies[0].messages[0].content[0].text,
    'Current camera and pointer context',
  );
  assert.equal(
    socket.sent
      .map(JSON.parse)
      .some((event) => event.type === 'response.create'),
    false,
  );
  resolve();
  await new Promise((done) => setTimeout(done, 0));
  assert.ok(
    socket.sent
      .map(JSON.parse)
      .some((event) =>
        event.session?.instructions?.includes('A visible airport'),
      ),
  );
  assert.equal(JSON.parse(socket.sent.at(-1)).type, 'response.create');
  backend.sendEvent(socket, {
    type: 'conversation.item.delete',
    item_id: 'current-image',
  });
  assert.equal(
    JSON.parse(socket.sent.at(-1)).session.instructions,
    'base app policy',
  );
  assert.equal(
    socket.sent
      .map(JSON.parse)
      .some((event) => event.type === 'input_image_buffer.append'),
    false,
    'native realtime history never retains images',
  );
});

test('late viewport analysis cannot publish or answer after session disposal', async () => {
  const socket = fakeSocket();
  let resolve;
  const backend = createDashScopeBackend({
    visionTransport: async () => {
      await new Promise((done) => {
        resolve = done;
      });
      return Response.json({
        message: { role: 'assistant', content: 'Stale screen' },
      });
    },
  });
  backend.configureSession(socket, {
    session: { instructions: 'base policy' },
  });
  backend.sendEvent(socket, {
    type: 'conversation.item.create',
    item: {
      id: 'old',
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_image', image_url: 'data:image/jpeg;base64,AAAA' },
      ],
    },
  });
  backend.sendEvent(socket, { type: 'response.create' });
  await new Promise((done) => setTimeout(done, 0));
  backend.disposeSession();
  resolve();
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(
    socket.sent
      .map(JSON.parse)
      .some((event) => event.type === 'response.create'),
    false,
  );
  assert.equal(
    socket.sent
      .map(JSON.parse)
      .some((event) => event.session?.instructions?.includes('Stale screen')),
    false,
  );
});

test('replacing viewport clears prior instructions before cancelled analysis settles', async () => {
  const socket = fakeSocket();
  let finish;
  let calls = 0;
  const backend = createDashScopeBackend({
    visionTransport: async () => {
      if (++calls === 2)
        await new Promise((resolve) => {
          finish = resolve;
        });
      return Response.json({
        message: { content: calls === 1 ? 'Snapshot A' : 'Snapshot B' },
      });
    },
  });
  backend.configureSession(socket, { session: { instructions: 'base' } });
  const image = (id) => ({
    type: 'conversation.item.create',
    item: {
      id,
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_image', image_url: 'data:image/jpeg;base64,AAAA' },
      ],
    },
  });
  backend.sendEvent(socket, image('A'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(
    JSON.parse(socket.sent.at(-1)).session.instructions,
    /Snapshot A/,
  );
  backend.sendEvent(socket, image('B'));
  assert.equal(JSON.parse(socket.sent.at(-1)).session.instructions, 'base');
  backend.sendEvent(socket, { type: 'response.create' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  backend.observeEvent(socket, { type: 'input_audio_buffer.speech_started' });
  finish();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(JSON.parse(socket.sent.at(-1)).session.instructions, 'base');
  assert.equal(
    socket.sent
      .map(JSON.parse)
      .some((event) => event.type === 'response.create'),
    false,
  );
});
