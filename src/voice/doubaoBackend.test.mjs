import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DOUBAO_EVENTS,
  createDoubaoBackend,
  decodeServerFrame,
  encodeAudioFrame,
  encodeJsonFrame,
  translateDoubaoFrame,
} from './doubaoBackend.js';

test('a JSON frame has the header the service accepts', () => {
  // The live service rejects every other header: gzipped bodies answer
  // "invalid char \x1f\x8b", and an 8-byte header desynchronises the reader.
  const frame = encodeJsonFrame(1, { dialogue: { bot_name: 'x' } });
  assert.equal(frame[0], 0x11, 'version 1, header size 1 word');
  assert.equal(frame[1], 0x14, 'message type 1 (full client), flags 4 (JSON)');
  assert.equal(frame[2], 0x10, 'serialization JSON, no compression');
  assert.equal(frame[3], 0x00);
  // The body must be plain JSON, never a gzip stream.
  assert.notEqual(frame[12], 0x1f);
  assert.notEqual(frame[13], 0x8b);
});

test('the event id is big-endian right after the header', () => {
  const frame = encodeJsonFrame(501, { content: 'hi' });
  assert.equal(frame.readUInt32BE(4), 501);
});

test('a session frame carries the id between event and payload', () => {
  const frame = encodeJsonFrame(200, { a: 1 }, 'sess-1');
  assert.equal(frame.readUInt32BE(8), 6, 'session id length');
  assert.equal(frame.subarray(12, 18).toString(), 'sess-1');
  const payloadLength = frame.readUInt32BE(18);
  assert.equal(
    frame.subarray(22, 22 + payloadLength).toString(),
    JSON.stringify({ a: 1 }),
  );
});

test('an audio frame uses the audio message type and raw payload', () => {
  const pcm = Buffer.from([0x00, 0x3b, 0x00, 0x1a]);
  const frame = encodeAudioFrame(200, pcm);
  assert.equal(frame[1], 0x20, 'message type 2 (audio-only client)');
  assert.equal(frame.readUInt32BE(4), 200);
  const length = frame.readUInt32BE(8);
  assert.equal(length, pcm.length);
  assert.deepEqual([...frame.subarray(12, 16)], [0x00, 0x3b, 0x00, 0x1a]);
});

/** Build a server frame the way the service does. */
function serverFrame({ event, sessionId = '', body }) {
  const parts = [Buffer.from([0x11, 0xb4, 0x00, 0x00]), Buffer.alloc(4)];
  parts[1].writeUInt32BE(event);
  if (sessionId) {
    const id = Buffer.from(sessionId);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(id.length);
    parts.push(length, id);
  }
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  parts.push(length, payload);
  return Buffer.concat(parts);
}

test('a text event is parsed with its session id', () => {
  const frame = decodeServerFrame(
    serverFrame({
      event: DOUBAO_EVENTS.chatResponse,
      sessionId: 'abc12345-6789-4abc-8def-0123456789ab',
      body: JSON.stringify({ content: '你好' }),
    }),
  );
  assert.equal(frame.event, 550);
  assert.equal(frame.sessionId, 'abc12345-6789-4abc-8def-0123456789ab');
  assert.equal(frame.json.content, '你好');
  assert.equal(frame.audio, null);
});

test('an audio event yields raw PCM, not a JSON parse failure', () => {
  // 32768 bytes of PCM16 — the size the live service actually sends. Its first
  // bytes are not valid UTF-8 JSON, so treating it as text would corrupt it.
  const pcm = Buffer.alloc(32768);
  pcm.writeInt16LE(0x163b, 0);
  const frame = decodeServerFrame(
    serverFrame({ event: DOUBAO_EVENTS.ttsResponse, sessionId: 'abc12345-6789-4abc-8def-0123456789ab', body: pcm }),
  );
  assert.equal(frame.event, 352);
  assert.equal(frame.audio.length, 32768);
  assert.equal(frame.audio.readInt16LE(0), 0x163b);
  assert.equal(frame.json, null);
});

test('a connection-level frame without a session id still decodes', () => {
  const frame = decodeServerFrame(
    serverFrame({ event: DOUBAO_EVENTS.connectionStarted, body: '{}' }),
  );
  assert.equal(frame.event, 50);
  assert.equal(frame.sessionId, '');
  assert.deepEqual(frame.json, {});
});

test('an error frame is surfaced as a message, not as a failed parse', () => {
  const body = Buffer.from(
    JSON.stringify({ error: 'sami error: DialogAudioIdleTimeoutError' }),
  );
  const frame = decodeServerFrame(
    Buffer.concat([Buffer.from([0x11, 0xf0, 0x10, 0x00, 0, 0, 0, 1]), body]),
  );
  assert.equal(frame.type, 0xf);
  assert.match(frame.error, /DialogAudioIdleTimeoutError/);
});

test('authentication travels in headers, never in the URL', () => {
  let opened = null;
  const socket = {
    send() {},
    close() {},
    addEventListener() {},
    removeEventListener() {},
  };
  const backend = createDoubaoBackend({
    WebSocketImpl: (url, options) => {
      opened = { url, options };
      return socket;
    },
  });
  void backend
    .openSocket({
      credential: { appId: '4010351512', token: 'secret-token' },
    })
    .catch(() => {});
  assert.match(opened.url, /^wss:\/\/openspeech\.bytedance\.com/);
  assert.doesNotMatch(opened.url, /secret-token/);
  assert.equal(opened.options.headers['X-Api-App-ID'], '4010351512');
  assert.equal(opened.options.headers['X-Api-Access-Key'], 'secret-token');
});

test('the audio rates match what the session asks the service for', () => {
  const backend = createDoubaoBackend();
  // 24 kHz is the TTS rate requested in StartSession; sending 16 kHz audio and
  // playing it back at 24 kHz would sound like chipmunks.
  assert.equal(backend.audio.outputHz, 24_000);
  assert.equal(backend.audio.inputHz, 16_000);
});

test('the vendor vocabulary is translated into the shared event names', () => {
  // The rest of the voice stack keys off `payload.type`; Doubao numbers its
  // events, and this is the only place the two meet.
  const reply = translateDoubaoFrame(
    decodeServerFrame(
      serverFrame({
        event: DOUBAO_EVENTS.chatResponse,
        sessionId: 'abc12345-6789-4abc-8def-0123456789ab',
        body: JSON.stringify({ content: '你好呀，' }),
      }),
    ),
  );
  assert.equal(reply.type, 'response.text.delta');
  assert.equal(reply.delta, '你好呀，');

  const ended = translateDoubaoFrame(
    decodeServerFrame(
      serverFrame({
        event: DOUBAO_EVENTS.chatEnded,
        sessionId: 'abc12345-6789-4abc-8def-0123456789ab',
        body: '{}',
      }),
    ),
  );
  assert.equal(ended.type, 'response.done');
});

test('a frame with nothing to say translates to null', () => {
  const frame = decodeServerFrame(
    serverFrame({ event: 999, body: '{}' }),
  );
  assert.equal(translateDoubaoFrame(frame), null);
  assert.equal(translateDoubaoFrame(null), null);
});
