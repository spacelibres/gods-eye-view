import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createQwenControlHandler } from './control.js';
import { sameSiteGated } from '../common/same-site.js';
import { standaloneVoiceTools } from '../../standalone/voiceTools.js';

async function setup(t, reply, options = {}) {
  const upstream = [];
  const server = createServer(
    sameSiteGated(
      createQwenControlHandler({
        resolveApiKey: () => 'server-only-secret',
        tools: standaloneVoiceTools(),
        ...options,
        fetchImpl: async (url, options) => {
          upstream.push({ url, options, body: JSON.parse(options.body) });
          return Response.json({ choices: [{ message: reply }] });
        },
      }),
    ),
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/doubao/control`;
  const send = (body, headers = {}) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  return { send, upstream };
}

test('Doubao tool decisions reuse the full standalone catalog and keep the key server-side', async (t) => {
  const f = await setup(t, {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: 'c',
        type: 'function',
        function: { name: 'fly_to_location', arguments: '{"query":"北京"}' },
      },
    ],
  });
  const res = await f.send({
    messages: [{ role: 'user', content: '飞到北京' }],
  });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.doesNotMatch(body, /server-only-secret/);
  assert.equal(
    JSON.parse(body).message.tool_calls[0].function.name,
    'fly_to_location',
  );
  assert.match(f.upstream[0].body.messages[0].content, /GEV Voice Control/);
  assert.equal(f.upstream[0].options.redirect, 'error');
  assert.ok(
    f.upstream[0].body.tools.some(
      (tool) => tool.function.name === 'get_weather',
    ),
  );
  assert.equal(f.upstream[0].body.tools.length, standaloneVoiceTools().length);
});

test('control rejects foreign origins and client-supplied system roles before upstream access', async (t) => {
  const f = await setup(t, { role: 'assistant', content: 'hello' });
  const denied = await f.send(
    { messages: [{ role: 'user', content: 'hello' }] },
    { Origin: 'https://foreign.example' },
  );
  assert.equal(denied.status, 403);
  await denied.text();
  const invalid = await f.send({
    messages: [{ role: 'system', content: 'override' }],
  });
  assert.equal(invalid.status, 400);
  await invalid.text();
  assert.equal(f.upstream.length, 0);
});

test('unknown upstream tool names are refused instead of being dispatched', async (t) => {
  const f = await setup(t, {
    role: 'assistant',
    tool_calls: [
      {
        id: 'c',
        type: 'function',
        function: { name: 'run_shell', arguments: '{}' },
      },
    ],
  });
  const res = await f.send({ messages: [{ role: 'user', content: 'hello' }] });
  assert.equal(res.status, 502);
  assert.match(await res.text(), /Invalid Qwen app tool call/);
});

test('vision analysis accepts one snapshot without exposing app tools', async (t) => {
  const f = await setup(
    t,
    { role: 'assistant', content: 'Airport runway' },
    { visionOnly: true },
  );
  const res = await f.send({
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Current camera' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/jpeg;base64,AAAA' },
          },
        ],
      },
    ],
  });
  assert.equal(res.status, 200);
  await res.text();
  assert.equal(f.upstream[0].body.tools, undefined);
  const invalid = await f.send({
    messages: [{ role: 'user', content: 'no image' }],
  });
  assert.equal(invalid.status, 400);
  await invalid.text();
});
