import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PcmPlayer,
  decodePcm16,
  encodePcm16,
  fromBase64,
  startWebSocketSession,
  toBase64,
} from './websocketSession.js';

test('float samples survive a PCM16 round trip', () => {
  const samples = new Float32Array([0, 0.5, -0.5, 0.25, -0.25, 1, -1]);
  const decoded = decodePcm16(encodePcm16(samples));
  assert.equal(decoded.length, samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    // 16-bit quantisation: one step is 1/32767.
    assert.ok(
      Math.abs(decoded[i] - samples[i]) < 1 / 32000,
      `sample ${i}: ${decoded[i]} vs ${samples[i]}`,
    );
  }
});

test('full scale maps to both ends of the 16-bit range', () => {
  const bytes = encodePcm16(new Float32Array([1, -1]));
  const view = new DataView(bytes.buffer);
  assert.equal(view.getInt16(0, true), 32767);
  assert.equal(view.getInt16(2, true), -32768);
});

test('out-of-range samples are clamped instead of wrapping', () => {
  // Without clamping, 2.0 would wrap to a loud negative value.
  const view = new DataView(encodePcm16(new Float32Array([2, -2])).buffer);
  assert.equal(view.getInt16(0, true), 32767);
  assert.equal(view.getInt16(2, true), -32768);
});

test('PCM bytes are little-endian, as every vendor expects', () => {
  const bytes = encodePcm16(new Float32Array([1]));
  // 32767 is 0x7FFF: low byte first.
  assert.deepEqual([...bytes], [0xff, 0x7f]);
});

test('base64 round-trips arbitrary bytes', () => {
  const bytes = new Uint8Array([0, 1, 127, 128, 255, 254]);
  assert.deepEqual([...fromBase64(toBase64(bytes))], [...bytes]);
});

test('base64 survives a payload larger than one fromCharCode step', () => {
  // The step size exists because spreading a huge array overflows the stack.
  const bytes = new Uint8Array(100_000);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 256;
  const round = fromBase64(toBase64(bytes));
  assert.equal(round.length, bytes.length);
  assert.equal(round[99_999], bytes[99_999]);
});

/** An AudioContext stand-in recording what was scheduled. */
function fakeAudioContext({ sampleRate = 48_000 } = {}) {
  const scheduled = [];
  let now = 10;
  return {
    sampleRate,
    destination: {},
    get currentTime() {
      return now;
    },
    resume: async () => {},
    close: async () => {},
    createBuffer(channels, length, rate) {
      return {
        duration: length / rate,
        copyToChannel(data) {
          this.data = data;
        },
        length,
        rate,
      };
    },
    createBufferSource() {
      return {
        connect() {},
        start(at) {
          scheduled.push({ at, buffer: this.buffer });
        },
      };
    },
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    },
    createScriptProcessor() {
      return { connect() {}, disconnect() {}, onaudioprocess: null };
    },
    createGain() {
      return { connect() {}, disconnect() {}, gain: { value: 1 } };
    },
    scheduled,
    advance(seconds) {
      now += seconds;
    },
  };
}

test('audio deltas are scheduled back to back, never overlapping', () => {
  const context = fakeAudioContext();
  const player = new PcmPlayer({ context, outputHz: 24_000 });
  // 240 samples at 24 kHz is 10 ms.
  const chunk = new Uint8Array(240 * 2);
  player.push(chunk);
  player.push(chunk);
  assert.equal(context.scheduled.length, 2);
  const [first, second] = context.scheduled;
  assert.equal(first.at, 10);
  assert.ok(
    Math.abs(second.at - (first.at + first.buffer.duration)) < 1e-9,
    'the second chunk starts where the first ends',
  );
});

test('a late chunk does not schedule in the past', () => {
  const context = fakeAudioContext();
  const player = new PcmPlayer({ context, outputHz: 24_000 });
  player.push(new Uint8Array(240 * 2));
  // The clock runs past the scheduled end: a chunk arriving now must start now.
  context.advance(1);
  player.push(new Uint8Array(240 * 2));
  assert.equal(context.scheduled[1].at, context.currentTime);
});

test('barge-in resets the schedule so the reply starts from now', () => {
  const context = fakeAudioContext();
  const player = new PcmPlayer({ context, outputHz: 24_000 });
  player.push(new Uint8Array(240 * 2));
  player.reset();
  context.advance(0.05);
  player.push(new Uint8Array(240 * 2));
  assert.equal(context.scheduled[1].at, context.currentTime);
});

/** A socket stand-in whose messages the test can raise. */
function fakeSocket() {
  const listeners = new Map();
  return {
    sent: [],
    closed: false,
    send(data) {
      this.sent.push(data);
    },
    close() {
      this.closed = true;
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    emit(type, event) {
      for (const handler of [...(listeners.get(type) ?? [])]) handler(event);
    },
  };
}

function fakeBackend(socket, audio = { inputHz: 16_000, outputHz: 24_000 }) {
  return {
    audio,
    async openSocket() {
      return socket;
    },
    sendEvent(_socket, event) {
      socket.send(JSON.stringify(event));
    },
    appendAudio(_socket, audio64) {
      socket.send(
        JSON.stringify({ type: 'input_audio_buffer.append', audio: audio64 }),
      );
    },
  };
}

test('a session plays audio deltas and forwards every event', async () => {
  const socket = fakeSocket();
  const seen = [];
  const session = await startWebSocketSession({
    backend: fakeBackend(socket),
    credential: { token: 't' },
    callbacks: { onEvent: (payload) => seen.push(payload.type) },
    AudioContextClass: fakeAudioContext,
    getUserMedia: async () => ({
      getTracks: () => [{ stop() {} }],
    }),
  });

  socket.emit('message', {
    data: JSON.stringify({
      type: 'response.audio.delta',
      delta: toBase64(new Uint8Array([0, 0, 0, 0])),
    }),
  });
  assert.ok(seen.includes('response.audio.delta'));
  session.stop();
  assert.equal(socket.closed, true);
});

test('a malformed delta does not take the session down', async () => {
  const socket = fakeSocket();
  await startWebSocketSession({
    backend: fakeBackend(socket),
    credential: { token: 't' },
    AudioContextClass: fakeAudioContext,
    getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
  });
  // Not base64: atob throws, and the session must survive it.
  socket.emit('message', {
    data: JSON.stringify({
      type: 'response.audio.delta',
      delta: '!!!not base64!!!',
    }),
  });
  socket.emit('message', { data: 'not json at all' });
  assert.equal(socket.closed, false);
});

test('a missing microphone does not take the session down', async () => {
  // "Requested device not found" is a device problem. Reporting it as a
  // connection error sent the user to check a network that was fine, and the
  // session had already connected.
  const socket = fakeSocket();
  const failures = [];
  const session = await startWebSocketSession({
    backend: fakeBackend(socket),
    credential: { token: 't' },
    callbacks: { onMicrophoneError: (error) => failures.push(error.name) },
    AudioContextClass: fakeAudioContext,
    getUserMedia: async () => {
      const error = new Error('Requested device not found');
      error.name = 'NotFoundError';
      throw error;
    },
  });
  assert.deepEqual(failures, ['NotFoundError']);
  assert.equal(session.microphoneOpen, false);
  // The socket is still usable: a typed question gets a spoken answer.
  assert.equal(socket.closed, false);
  session.sendText('你好');
  assert.ok(socket.sent.length > 0, 'a text turn still goes out');
  session.stop();
});

test('stopping releases the microphone and the context', async () => {
  const socket = fakeSocket();
  let tracksStopped = 0;
  let contextClosed = false;
  class Context extends Object {
    constructor() {
      const base = fakeAudioContext();
      return Object.assign(base, {
        close: async () => {
          contextClosed = true;
        },
      });
    }
  }
  const session = await startWebSocketSession({
    backend: fakeBackend(socket),
    credential: { token: 't' },
    AudioContextClass: Context,
    getUserMedia: async () => ({
      getTracks: () => [
        {
          stop() {
            tracksStopped += 1;
          },
        },
      ],
    }),
  });
  session.stop();
  assert.equal(tracksStopped, 1);
  assert.equal(contextClosed, true);
});

test('socket sessions expose the controller channel for tools, context and typed commands', async () => {
  const socket = fakeSocket();
  const session = await startWebSocketSession({
    backend: fakeBackend(socket),
    credential: { token: 't' },
    AudioContextClass: fakeAudioContext,
    getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
  });
  assert.equal(session.channel.readyState, 'open');
  session.channel.send(
    JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: 'c1',
        output: '{"ok":true}',
      },
    }),
  );
  session.channel.send(JSON.stringify({ type: 'response.create' }));
  assert.deepEqual(
    socket.sent
      .map(JSON.parse)
      .slice(-2)
      .map((e) => e.type),
    ['conversation.item.create', 'response.create'],
  );
  session.stop();
  assert.equal(session.channel.readyState, 'closed');
});

test('a released socket microphone cannot reopen after delayed reacquisition', async () => {
  const socket = fakeSocket();
  let finish;
  let attempts = 0;
  let stopped = 0;
  const session = await startWebSocketSession({
    backend: fakeBackend(socket),
    credential: { token: 'fixture' },
    AudioContextClass: fakeAudioContext,
    getUserMedia: async () => {
      attempts++;
      if (attempts === 2)
        await new Promise((resolve) => {
          finish = resolve;
        });
      return {
        getTracks: () => [
          {
            stop() {
              stopped++;
            },
          },
        ],
      };
    },
  });
  session.setMicrophoneEnabled(false);
  const pending = session.setMicrophoneEnabled(true);
  session.setMicrophoneEnabled(false);
  finish();
  await pending;
  assert.equal(session.microphoneOpen, false);
  assert.equal(stopped, 2);
  session.stop();
});
