import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { attachVoiceSocketRelay } from './voice-socket-relay.js';

for (const binary of [false, true]) {
  test(`voice relay preserves ${binary ? 'binary voice' : 'JSON tool'} frames in both directions`, async (t) => {
    const upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await once(upstream, 'listening');
    let auth;
    upstream.on('connection', (socket, req) => {
      auth = req.headers.authorization;
      socket.on('message', (data, isBinary) =>
        socket.send(data, { binary: isBinary }),
      );
    });
    const server = createServer();
    const relay = attachVoiceSocketRelay({
      server,
      binary,
      upstreamUrl: `ws://127.0.0.1:${upstream.address().port}`,
      upstreamHeaders: () => ({ Authorization: 'Bearer fixture' }),
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const socket = new WebSocket(
      `ws://127.0.0.1:${server.address().port}/api/doubao/socket`,
    );
    t.after(async () => {
      socket.terminate();
      relay.close();
      for (const client of upstream.clients) client.terminate();
      await Promise.all([
        new Promise((resolve) => server.close(resolve)),
        new Promise((resolve) => upstream.close(resolve)),
      ]);
    });
    await once(socket, 'open');
    const echoed = once(socket, 'message');
    socket.send(
      binary ? new Uint8Array([1, 2, 3]) : '{"type":"function_call_output"}',
    );
    const [data, isBinary] = await echoed;
    assert.equal(isBinary, binary);
    assert.equal(auth, 'Bearer fixture');
    assert.equal(
      binary ? data.toString('hex') : data.toString(),
      binary ? '010203' : '{"type":"function_call_output"}',
    );
  });
}
