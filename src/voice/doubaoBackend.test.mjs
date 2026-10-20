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

/** Read a big-endian u32 the way the codec writes one. */
const u32At = (bytes, offset) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    offset,
    false,
  );

/** Build a server frame the way the service does. */
function serverFrame({ event, sessionId = '', body }) {
  const enc = new TextEncoder();
  const payload =
    body instanceof Uint8Array ? body : enc.encode(String(body ?? ''));
  const id = sessionId ? enc.encode(sessionId) : new Uint8Array(0);
  const header = new Uint8Array([0x11, 0xb4, 0x00, 0x00]);
  const parts = [header, new Uint8Array(4)];
  new DataView(parts[1].buffer).setUint32(0, event, false);
  if (id.length) {
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, id.length, false);
    parts.push(length, id);
  }
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, payload.length, false);
  parts.push(length, payload);
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

test('a JSON frame has the header the service accepts', () => {
  // The live service rejects every other header: compressed bodies answer
  // "invalid char \x1f\x8b", and an 8-byte header desynchronises the reader.
  const frame = encodeJsonFrame(1, { dialogue: { bot_name: 'x' } });
  assert.equal(frame[0], 0x11, 'version 1, header size 1 word');
  assert.equal(frame[1], 0x14, 'message type 1 (full client), flags 4 (JSON)');
  assert.equal(frame[2], 0x10, 'serialization JSON, no compression');
  assert.equal(frame[3], 0x00);
  // The body must be plain JSON, never a compression stream.
  assert.notEqual(frame[12], 0x1f);
  assert.notEqual(frame[13], 0x8b);
});

test('the event id is big-endian right after the header', () => {
  assert.equal(u32At(encodeJsonFrame(501, { content: 'hi' }), 4), 501);
});

test('a session frame carries the id between event and payload', () => {
  const frame = encodeJsonFrame(200, { a: 1 }, 'sess-1');
  assert.equal(u32At(frame, 8), 6, 'session id length');
  assert.equal(
    new TextDecoder().decode(frame.subarray(12, 18)),
    'sess-1',
  );
  const payloadLength = u32At(frame, 18);
  assert.equal(
    new TextDecoder().decode(frame.subarray(22, 22 + payloadLength)),
    JSON.stringify({ a: 1 }),
  );
});

test('an audio frame is TaskRequest with the mandatory event flag', () => {
  const pcm = new Uint8Array([0x00, 0x3b, 0x00, 0x1a]);
  const frame = encodeAudioFrame(pcm);
  assert.equal(frame[0], 0x11);
  // Byte 1 is Message Type (high nibble) | flags (low nibble). Audio is type 2,
  // and the `event` field is mandatory for every client frame, so the byte is
  // 0x24. Writing 0x20 said "type 2, no event", and the service then read the
  // event id as a body length: "expected=200 actual=684".
  assert.equal(frame[1], 0x24, 'type 2 (audio-only) with the event flag');
  assert.equal(frame[2], 0x10, 'JSON serialization, no compression');
  assert.equal(u32At(frame, 4), DOUBAO_EVENTS.taskRequest, 'event 200');
  assert.equal(u32At(frame, 8), pcm.length, 'payload length after the event');
  assert.deepEqual([...frame.subarray(12, 16)], [0x00, 0x3b, 0x00, 0x1a]);
});

test('an audio frame addresses the session when it has an id', () => {
  const pcm = new Uint8Array([1, 2, 3, 4]);
  const sid = 'abc12345-6789-4abc-8def-0123456789ab';
  const frame = encodeAudioFrame(pcm, sid);
  assert.equal(u32At(frame, 4), DOUBAO_EVENTS.taskRequest);
  assert.equal(u32At(frame, 8), sid.length, 'session id length');
  assert.equal(new TextDecoder().decode(frame.subarray(12, 12 + sid.length)), sid);
  assert.equal(u32At(frame, 12 + sid.length), pcm.length);
});

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
  const pcm = new Uint8Array(32768);
  new DataView(pcm.buffer).setInt16(0, 0x163b, true);
  const frame = decodeServerFrame(
    serverFrame({
      event: DOUBAO_EVENTS.ttsResponse,
      sessionId: 'abc12345-6789-4abc-8def-0123456789ab',
      body: pcm,
    }),
  );
  assert.equal(frame.event, 352);
  assert.equal(frame.audio.length, 32768);
  assert.equal(
    new DataView(frame.audio.buffer, frame.audio.byteOffset).getInt16(0, true),
    0x163b,
  );
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
  const body = new TextEncoder().encode(
    JSON.stringify({ error: 'sami error: DialogAudioIdleTimeoutError' }),
  );
  // Error frames put their message straight after the header, with no event
  // or session id, so the reader must not try to parse a length first.
  const frame = new Uint8Array(8 + body.length);
  frame.set([0x11, 0xf0, 0x10, 0x00], 0);
  frame.set(body, 8);
  const decoded = decodeServerFrame(frame);
  assert.equal(decoded.type, 0xf);
  assert.match(decoded.error, /DialogAudioIdleTimeoutError/);
});

test('the page connects to the relay, never to the vendor', () => {
  // The browser cannot attach headers to a WebSocket: a second argument is the
  // protocol list, so `{ headers }` throws "The subprotocol '[object Object]'
  // is invalid". The credential is added by the server on the way out.
  let opened = null;
  const socket = {
    send() {},
    close() {},
    addEventListener() {},
    removeEventListener() {},
  };
  const backend = createDoubaoBackend({
    origin: 'https://godseye.example',
    WebSocketImpl: (url) => {
      opened = url;
      return socket;
    },
  });
  void backend
    .openSocket({ credential: { appId: '1', token: 't' } })
    .catch(() => {});
  // An https page must produce a wss URL; a plain ws one is mixed content.
  assert.match(
    opened,
    /^wss:\/\/.*\/api\/doubao\/socket$/,
    'a same-origin relay path over wss',
  );
  assert.doesNotMatch(opened, /openspeech\.bytedance\.com/);
});

test('the web socket receives one argument, never an options object', () => {
  // A second argument is what produced the browser error; this pins that the
  // opener passes exactly one.
  let argCount = null;
  const socket = {
    send() {},
    close() {},
    addEventListener() {},
    removeEventListener() {},
  };
  const backend = createDoubaoBackend({
    origin: 'https://godseye.example',
    WebSocketImpl: (...args) => {
      argCount = args.length;
      return socket;
    },
  });
  void backend
    .openSocket({ credential: { appId: '1', token: 't' } })
    .catch(() => {});
  assert.equal(argCount, 1, 'one argument: the URL');
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
  const frame = decodeServerFrame(serverFrame({ event: 999, body: '{}' }));
  assert.equal(translateDoubaoFrame(frame), null);
  assert.equal(translateDoubaoFrame(null), null);
});
