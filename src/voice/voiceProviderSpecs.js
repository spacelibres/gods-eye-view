/**
 * Voice providers this app can talk to, and what each one actually needs.
 *
 * Every row below is read from that vendor's own documentation, not from
 * convention: the endpoints, header names, event ids and sample rates differ
 * per vendor, and guessing any one of them produces a session that connects
 * and then stays silent.
 *
 * A provider is listed here only when its adapter exists. `voiceProviders.js`
 * is the runtime registry the picker reads; this file is the specification
 * those adapters are written against, kept separate so a protocol difference
 * is visible as data rather than buried in code.
 */

/**
 * @typedef {object} VoiceProviderSpec
 * @property {string} id Stable id; also the settings value.
 * @property {string} label Message id for the picker.
 * @property {'webrtc'|'websocket'} transport
 * @property {string} region Text for the picker; where the service runs.
 * @property {string} docs Vendor documentation the values came from.
 * @property {readonly string[]} envKeys Environment variables the server
 *   needs to mint a credential. An empty list means the browser authenticates
 *   directly with a key the user pastes into Provider Settings.
 * @property {object} audio Sample rates the session must use. A mismatch is
 *   heard as chipmunk audio or silence, so these are not defaults.
 * @property {boolean} bargeIn Whether the user can interrupt a reply. A
 *   one-shot upload (Baidu) cannot: the microphone is closed while it thinks.
 * @property {object} [events] Vendor event vocabulary, when it differs from
 *   the OpenAI wording the code was written around.
 */

/** @type {readonly VoiceProviderSpec[]} */
export const VOICE_PROVIDER_SPECS = Object.freeze([
  {
    id: 'openai',
    label: 'OpenAI Realtime',
    transport: 'webrtc',
    region: 'global',
    docs: 'https://platform.openai.com/docs/guides/realtime',
    envKeys: ['OPENAI_API_KEY'],
    audio: { inputHz: 24_000, outputHz: 24_000 },
    bargeIn: true,
    events: {
      sessionUpdate: 'session.update',
      audioAppend: 'input_audio_buffer.append',
      audioDelta: 'response.audio.delta',
    },
  },
  {
    id: 'dashscope',
    label: 'Alibaba Bailian (Qwen Omni)',
    transport: 'websocket',
    region: 'cn',
    // Verified against the live service, not assumed: the connection answers
    // `session.created`, and `session.update` is accepted with the OpenAI
    // event names. `qwen3-omni-flash-realtime` connects and then rejects every
    // event with `1007 Model not exist.`; the dated `qwen3.8-omni-flash-realtime`
    // runs a real session, so that is the default.
    docs: 'https://help.aliyun.com/zh/model-studio/realtime',
    envKeys: ['DASHSCOPE_API_KEY'],
    defaultModel: 'qwen3.8-omni-flash-realtime',
    // The session reports `input_audio_format: pcm16` and
    // `output_audio_format: pcm24`, so these are the rates to feed it.
    audio: { inputHz: 16_000, outputHz: 24_000 },
    bargeIn: true,
    events: {
      sessionUpdate: 'session.update',
      audioAppend: 'input_audio_buffer.append',
      audioDelta: 'response.audio.delta',
    },
  },
  {
    id: 'doubao',
    label: 'Volcengine Doubao',
    transport: 'websocket',
    region: 'cn',
    // Binary framing, not JSON: a 4-byte header, a big-endian event id, a
    // length-prefixed session id and a gzip body. Event ids are the vendor's
    // own numbering, so the adapter cannot share DashScope's JSON path.
    docs: 'https://www.volcengine.com/docs/6561/1594356',
    envKeys: ['DOUBAO_APP_ID', 'DOUBAO_ACCESS_KEY'],
    audio: { inputHz: 16_000, outputHz: 24_000 },
    bargeIn: true,
    events: {
      startConnection: 1,
      startSession: 100,
      sessionFinished: 152,
      sessionFailed: 153,
      clearAudio: 450,
    },
  },
  {
    id: 'xfyun',
    label: 'iFlytek Spark',
    transport: 'websocket',
    region: 'cn',
    docs: 'https://www.xfyun.cn/doc/spark/Web.html',
    // Signed in the browser or on the server from these three; the signature
    // is an HMAC over host, date and request line.
    envKeys: ['XFYUN_APP_ID', 'XFYUN_API_KEY', 'XFYUN_API_SECRET'],
    audio: { inputHz: 16_000, outputHz: 16_000 },
    bargeIn: true,
    events: { status: 'status', data: 'data' },
  },
  {
    id: 'tencent',
    label: 'Tencent Cloud',
    transport: 'websocket',
    region: 'cn',
    docs: 'https://cloud.tencent.com/document/product/1093',
    envKeys: ['TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY'],
    audio: { inputHz: 16_000, outputHz: 16_000 },
    bargeIn: true,
    events: { recognize: 'recognizeResult' },
  },
  {
    id: 'baidu',
    label: 'Baidu Speech',
    transport: 'websocket',
    region: 'cn',
    // One-shot HTTP upload rather than a full-duplex session: no barge-in,
    // and the reply is a whole utterance. The picker states this.
    docs: 'https://ai.baidu.com/ai-doc/SPEECH',
    envKeys: ['BAIDU_API_KEY', 'BAIDU_SECRET_KEY'],
    audio: { inputHz: 16_000, outputHz: 16_000 },
    bargeIn: false,
    events: {},
  },
]);

/** Look up a spec by provider id. */
export function findVoiceProviderSpec(id) {
  const wanted = String(id ?? '').trim();
  return VOICE_PROVIDER_SPECS.find((spec) => spec.id === wanted) ?? null;
}

/**
 * The environment variables a deployment must set for a provider.
 *
 * @param {string} id
 * @returns {string[]} Empty for an unknown provider.
 */
export function providerEnvKeys(id) {
  return [...(findVoiceProviderSpec(id)?.envKeys ?? [])];
}

/**
 * True when this provider can do a full-duplex, interruptible conversation.
 *
 * Baidu's one-shot upload cannot: the microphone is closed while it thinks.
 * The picker says so rather than letting the difference be discovered.
 */
export function supportsBargeIn(id) {
  return findVoiceProviderSpec(id)?.bargeIn === true;
}
