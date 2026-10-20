import test from 'node:test';
import assert from 'node:assert/strict';
import { createDoubaoControlChannel } from './doubaoControl.js';

function setup(reply) {
  const events = [];
  const sent = [];
  const requests = [];
  const channel = createDoubaoControlChannel({
    request: async (messages, options) => {
      requests.push(structuredClone(messages));
      return reply(messages, options);
    },
    speak: (text) => sent.push(text),
    onEvent: async (event) => events.push(event),
  });
  return { channel, events, sent, requests };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('Doubao recognition drives tools and only executed results are spoken', async () => {
  const f = setup((messages) =>
    messages.some((m) => m.role === 'tool')
      ? { role: 'assistant', content: '已飞到北京。' }
      : {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call1',
              type: 'function',
              function: {
                name: 'fly_to_location',
                arguments: '{"query":"北京"}',
              },
            },
          ],
        },
  );
  f.channel.handleFrame({ event: 450, json: {} });
  f.channel.handleFrame({
    event: 451,
    json: { results: [{ text: '飞到北京', is_interim: false }] },
  });
  f.channel.handleFrame({ event: 459, json: {} });
  await tick();
  const call = f.events.find(
    (e) => e.type === 'response.function_call_arguments.done',
  );
  assert.equal(call.name, 'fly_to_location');
  assert.deepEqual(f.sent, []);
  f.channel.send(
    JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: 'call1',
        output: '{"ok":true,"action":"fly_to_location"}',
      },
    }),
  );
  f.channel.send(JSON.stringify({ type: 'response.create' }));
  await tick();
  assert.deepEqual(f.sent, ['已飞到北京。']);
  assert.equal(f.requests[1].at(-1).role, 'tool');
  assert.equal(
    f.channel.handleFrame({ event: 350, json: { tts_type: 'default' } }),
    true,
  );
  assert.equal(
    f.channel.handleFrame({ event: 352, audio: new Uint8Array([1, 2]) }),
    true,
    'unexecuted vendor chat is muted',
  );
  f.channel.handleFrame({ event: 350, json: { tts_type: 'chat_tts_text' } });
  assert.equal(
    f.channel.handleFrame({ event: 352, audio: new Uint8Array([1, 2]) }),
    false,
  );
  f.channel.handleFrame({ event: 359, json: {} });
  assert.equal(f.events.at(-1).type, 'response.done');
  f.channel.dispose();
});

test('speech interruption and disposal suppress late planner calls and TTS', async () => {
  let resolve;
  const f = setup(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  f.channel.send(
    JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '打开飞机图层' }],
      },
    }),
  );
  f.channel.send(JSON.stringify({ type: 'response.create' }));
  await tick();
  f.channel.handleFrame({ event: 450, json: {} });
  resolve({
    role: 'assistant',
    tool_calls: [
      {
        id: 'late',
        type: 'function',
        function: { name: 'set_layer_visibility', arguments: '{}' },
      },
    ],
  });
  await tick();
  assert.equal(
    f.events.some((e) => e.type === 'response.function_call_arguments.done'),
    false,
  );
  assert.deepEqual(f.sent, []);
  f.channel.dispose();
  assert.equal(f.channel.readyState, 'closed');
});

test('tool round limits survive added viewport context messages', async () => {
  const f = setup(() => ({
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: 'repeat',
        type: 'function',
        function: { name: 'fly_to_location', arguments: '{}' },
      },
    ],
  }));
  for (let i = 0; i < 20; i++) {
    f.channel.send(JSON.stringify({ type: 'response.create' }));
    await tick();
    f.channel.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          id: `frame-${i}`,
          content: [{ type: 'input_text', text: 'scene context' }],
        },
      }),
    );
  }
  assert.equal(f.requests.length, 16);
  f.channel.dispose();
});

test('deferred map events reach Doubao tool decisions as inert data', async () => {
  const f = setup(() => ({ role: 'assistant', content: 'Acknowledged' }));
  f.channel.send(
    JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: '{"type":"map_annotation_outline","status":"failed"}',
          },
        ],
      },
    }),
  );
  f.channel.send(JSON.stringify({ type: 'response.create' }));
  await tick();
  assert.equal(f.requests[0][0].role, 'user');
  assert.equal(
    f.requests[0][0].content[0].text.includes('map_annotation_outline'),
    true,
  );
  f.channel.dispose();
});
