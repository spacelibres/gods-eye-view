/**
 * A realtime voice session over a plain WebSocket.
 *
 * The WebRTC path in `realtimeConnection.js` gets full-duplex audio from the
 * browser's own media stack. A WebSocket service offers no media stack, so
 * this module carries the audio itself:
 *
 *   microphone → mono PCM16 at the vendor's input rate → base64 → JSON event
 *   vendor audio deltas → base64 → PCM16 at its output rate → AudioContext
 *
 * Keeping it separate is deliberate. The WebRTC path is well-tested and its
 * teardown is intricate; threading a second transport through it would put
 * both behind one set of regressions.
 *
 * Everything here is injectable (`AudioContextClass`, `getUserMedia`,
 * `createSocket`) so the framing and lifecycle can be tested without a
 * microphone.
 */

/** How much microphone audio to send per event. 20 ms at 16 kHz is 640 bytes. */
const CHUNK_MS = 20;

/**
 * Capture microphone audio as mono PCM16 chunks.
 *
 * `ScriptProcessor` is deprecated but is the only capture node available
 * without shipping an AudioWorklet module as a separate file, and the work per
 * callback is trivial (copy + convert). The audio itself never goes through the
 * main thread's rendering path.
 */
class MicrophonePcmSource {
  constructor({ context, stream, inputHz, onChunk }) {
    this.context = context;
    this.stream = stream;
    this.onChunk = onChunk;
    this.source = context.createMediaStreamSource(stream);
    this.bytesPerChunk = Math.round((inputHz * CHUNK_MS) / 1000);
    const bufferSize = pickBufferSize(context.sampleRate, this.bytesPerChunk);
    this.processor = context.createScriptProcessor(bufferSize, 1, 1);
    this.pending = [];
    this.pendingLength = 0;
    this.processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      this.pending.push(new Float32Array(input));
      this.pendingLength += input.length;
      this.drain();
    };
    // The processor must be connected to run; a zeroed gain keeps it inaudible.
    this.silence = context.createGain();
    this.silence.gain.value = 0;
    this.source.connect(this.processor);
    this.processor.connect(this.silence);
    this.silence.connect(context.destination);
  }

  /** Emit complete chunks, carrying the remainder to the next callback. */
  drain() {
    const needed = this.bytesPerChunk;
    while (this.pendingLength >= needed) {
      const samples = new Float32Array(needed);
      let filled = 0;
      while (filled < needed && this.pending.length) {
        const head = this.pending[0];
        const take = Math.min(head.length, needed - filled);
        samples.set(head.subarray(0, take), filled);
        filled += take;
        if (take === head.length) this.pending.shift();
        else this.pending[0] = head.subarray(take);
      }
      this.pendingLength -= needed;
      this.onChunk(encodePcm16(samples));
    }
  }

  stop() {
    this.processor.onaudioprocess = null;
    try {
      this.source.disconnect();
      this.processor.disconnect();
      this.silence.disconnect();
    } catch {
      // Disconnecting a node that was never fully wired is not an error.
    }
  }
}

/** A ScriptProcessor buffer has to be a power of two the engine accepts. */
function pickBufferSize(sampleRate, chunkBytes) {
  const options = [256, 512, 1024, 2048, 4096, 8192, 16384];
  const wanted = Math.max(chunkBytes, Math.round(sampleRate * 0.02));
  return options.find((size) => size >= wanted) ?? 16384;
}

/** Float32 [-1, 1] → little-endian PCM16 bytes. */
export function encodePcm16(samples) {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    // Asymmetric scaling: -1 maps to -32768, +1 to 32767.
    const value = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(i * 2, value, true);
  }
  return out;
}

/** Decode little-endian PCM16 bytes back to Float32 [-1, 1]. */
export function decodePcm16(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = Math.floor(bytes.byteLength / 2);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const value = view.getInt16(i * 2, true);
    out[i] = value < 0 ? value / 0x8000 : value / 0x7fff;
  }
  return out;
}

/** Base64 of the raw bytes, as every vendor's `audio` field expects. */
export function toBase64(bytes) {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/** Inverse of `toBase64`. */
export function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Play PCM16 deltas as they arrive.
 *
 * Deltas are scheduled back to back on the AudioContext clock rather than
 * queued in the DOM: overlapping buffers would clip, and starting each one at
 * "now" would stutter whenever a chunk arrives late.
 */
export class PcmPlayer {
  constructor({ context, outputHz }) {
    this.context = context;
    this.outputHz = outputHz;
    this.nextStart = 0;
  }

  /** @param {ArrayBuffer|Uint8Array} bytes little-endian PCM16 */
  push(bytes) {
    const samples = decodePcm16(
      bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
    );
    if (!samples.length) return;
    const buffer = this.context.createBuffer(1, samples.length, this.outputHz);
    buffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const startAt = Math.max(this.context.currentTime, this.nextStart);
    source.start(startAt);
    this.nextStart = startAt + buffer.duration;
  }

  /** Drop anything scheduled but not yet played — barge-in. */
  reset() {
    this.nextStart = 0;
  }
}

/**
 * Run one WebSocket voice session.
 *
 * @param {object} options
 * @param {object} options.backend A WebSocket backend (`openSocket`,
 *   `sendEvent`, `appendAudio`, `audio`).
 * @param {{token: string, model?: string}} options.credential
 * @param {object} options.callbacks `onEvent(payload)` for every vendor event,
 *   `onStatus(status, detail)`, `onError(error)`, `onStopped()`.
 * @param {AudioContext} [options.AudioContextClass]
 * @param {Function} [options.getUserMedia]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{stop: Function, setMicrophoneEnabled: Function,
 *   sendText: Function}>}
 */
export async function startWebSocketSession({
  backend,
  credential,
  callbacks = {},
  AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext,
  getUserMedia = (...args) => navigator.mediaDevices.getUserMedia(...args),
  signal,
} = {}) {
  const audio = backend.audio ?? { inputHz: 16_000, outputHz: 24_000 };
  const socket = await backend.openSocket({ credential, signal });
  const context = new AudioContextClass();
  const player = new PcmPlayer({ context, outputHz: audio.outputHz });
  let microphone = null;
  let stream = null;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    microphone?.stop();
    stream?.getTracks?.().forEach((track) => track.stop());
    try {
      socket.close();
    } catch {
      // A socket that already closed is fine.
    }
    context.close?.().catch?.(() => {});
    callbacks.onStopped?.();
  };

  socket.addEventListener('message', (event) => {
    // A vendor with a binary protocol supplies a decoder; one that speaks JSON
    // leaves it out and the payload is parsed directly.
    let payload;
    if (backend.decodeFrame) {
      let frame;
      try {
        frame = backend.decodeFrame(event.data);
      } catch {
        return;
      }
      if (frame?.error) {
        callbacks.onError?.(new Error(frame.error));
        return;
      }
      if (frame?.audio?.length) {
        try {
          player.push(frame.audio);
        } catch {
          // A malformed block must not take the session down.
        }
      }
      payload = backend.translateFrame?.(frame) ?? frame?.json ?? null;
      if (!payload) return;
    } else {
      try {
        payload = JSON.parse(String(event.data));
      } catch {
        return;
      }
    }
    if (
      payload?.type === 'response.audio.delta' &&
      typeof payload.delta === 'string'
    ) {
      try {
        player.push(fromBase64(payload.delta));
      } catch {
        // A malformed delta must not take the session down.
      }
    }
    if (payload?.type === 'input_audio_buffer.speech_started') player.reset();
    callbacks.onEvent?.(payload);
  });
  socket.addEventListener('close', () => {
    if (!closed) close();
  });
  socket.addEventListener('error', () => {
    callbacks.onError?.(new Error('Voice socket error'));
    close();
  });
  signal?.addEventListener?.('abort', () => close(), { once: true });

  const openMicrophone = async () => {
    if (microphone) return false;
    try {
      stream = await getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    } catch (error) {
      // A missing or blocked microphone must not take the whole session down:
      // typed questions and spoken replies work without one, and reporting the
      // failure as a connection error told the user the network was broken.
      callbacks.onMicrophoneError?.(error);
      return false;
    }
    if (closed) {
      stream.getTracks().forEach((track) => track.stop());
      return false;
    }
    microphone = new MicrophonePcmSource({
      context,
      stream,
      inputHz: audio.inputHz,
      onChunk: (bytes) => {
        if (closed) return;
        // A vendor that streams binary frames wants the bytes; one that speaks
        // JSON wants them base64-encoded in an event field.
        backend.appendAudio(
          socket,
          backend.audioEncoding === 'pcm' ? bytes : toBase64(bytes),
        );
      },
    });
    return true;
  };

  const closeMicrophone = () => {
    microphone?.stop();
    microphone = null;
    stream?.getTracks?.().forEach((track) => track.stop());
    stream = null;
  };

  await context.resume?.();
  // Best effort. A browser with no microphone, or one that refuses the request
  // outside a user gesture, still gets a working session for typed questions
  // and spoken replies.
  const microphoneOpen = await openMicrophone();

  return {
    socket,
    stop: close,
    get microphoneOpen() {
      return microphoneOpen || microphone !== null;
    },
    setMicrophoneEnabled(enabled) {
      if (enabled) return openMicrophone();
      closeMicrophone();
      return true;
    },
    sendText(text) {
      backend.sendEvent(socket, {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text }],
        },
      });
      backend.sendEvent(socket, { type: 'response.create' });
    },
  };
}
