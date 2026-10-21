#!/usr/bin/env node
/**
 * Credential-free voice control acceptance against the real development app.
 * Vendor replies are fixtures; application actions, turn handling and UI are real.
 * Run: node scripts/qa-voice-provider-controls.mjs http://127.0.0.1:4173
 */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const origin = new URL(process.argv[2] || 'http://127.0.0.1:4173').origin;
const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument(() => {
    const fetchOriginal = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(
        typeof input === 'string' ? input : input.url,
        location.href,
      );
      if (
        url.searchParams.get('probe') === '1' &&
        /\/api\/(realtime|doubao|dashscope)\/token/.test(url.pathname)
      )
        return Promise.resolve(Response.json({ configured: true }));
      return fetchOriginal(input, options);
    };
  });
  await page.goto(`${origin}/?welcome=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__gevVoiceCommands && window.__godsEyeView?.viewer,
    { timeout: 60000 },
  );
  await page.evaluate(async () => {
    const { createDashScopeBackend } =
      await import('/src/voice/dashscopeBackend.js');
    const { createDoubaoBackend, decodeServerFrame, encodeJsonFrame } =
      await import('/src/voice/doubaoBackend.js');
    const { resolveVoiceModel } = await import('/src/voice/voiceCost.js');
    // The provider facade owns switching; this protocol fixture injects transport
    // into the mounted realtime controller without replacing the shared runner.
    const controller = window.__gevVoiceCommands.session.adapter.controller;
    window.voiceQa = { controller, decodeServerFrame, encodeJsonFrame };
    window.voiceQa.start = async (provider) => {
      controller.stop();
      const socket = new EventTarget();
      socket.readyState = 1;
      socket.sent = [];
      socket.send = (data) => socket.sent.push(data);
      socket.close = () => {
        socket.readyState = 3;
      };
      socket.emit = (payload) =>
        socket.dispatchEvent(new MessageEvent('message', { data: payload }));
      const requests = [];
      const implementation =
        provider === 'dashscope'
          ? createDashScopeBackend()
          : createDoubaoBackend({
              controlTransport: async (_url, options) => {
                const body = JSON.parse(options.body);
                requests.push(body);
                const last = body.messages.at(-1);
                if (last.role === 'tool') {
                  const result = JSON.parse(last.content);
                  return Response.json({
                    message: {
                      role: 'assistant',
                      content: result.ok ? '操作已完成。' : '操作失败。',
                    },
                  });
                }
                const text =
                  typeof last.content === 'string'
                    ? last.content
                    : last.content.find((part) => part.type === 'text')?.text;
                return Response.json({
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                      {
                        id: `control-${requests.length}`,
                        type: 'function',
                        function: {
                          name: 'set_panel_open',
                          arguments: JSON.stringify({
                            panelId: 'data-panel',
                            open: !text.includes('关闭'),
                          }),
                        },
                      },
                    ],
                  },
                });
              },
            });
      controller._fixedBackend = {
        ...implementation,
        providerId: provider,
        requestToken: async () => ({
          token: 'fixture',
          model: resolveVoiceModel('mini').id,
          session: { instructions: 'Control the app', tools: [] },
        }),
        openSocket: async () => socket,
      };
      await controller.start();
      window.voiceQa.socket = socket;
      window.voiceQa.requests = requests;
      return controller.status;
    };
  });
  assert.equal(
    await page.evaluate(() => voiceQa.start('dashscope')),
    'listening',
  );
  for (const open of [false, true]) {
    await page.evaluate((open) => {
      const id = `panel-${open}`;
      voiceQa.socket.emit(
        JSON.stringify({ type: 'response.created', response: { id } }),
      );
      voiceQa.socket.emit(
        JSON.stringify({
          type: 'response.function_call_arguments.done',
          response_id: id,
          item_id: id,
          call_id: id,
          name: 'set_panel_open',
          arguments: JSON.stringify({ panelId: 'data-panel', open }),
        }),
      );
      voiceQa.socket.emit(
        JSON.stringify({
          type: 'response.done',
          response: { id, status: 'completed' },
        }),
      );
    }, open);
    await page.waitForFunction(
      (open) =>
        document
          .getElementById('data-panel')
          .classList.contains('collapsed') === !open,
      {},
      open,
    );
    const result = await page.waitForFunction(
      (open) =>
        voiceQa.socket.sent
          .map(JSON.parse)
          .find(
            (event) =>
              event.item?.call_id === `panel-${open}` &&
              event.item.type === 'function_call_output',
          ),
      {},
      open,
    );
    assert.equal(JSON.parse((await result.jsonValue()).item.output).ok, true);
  }
  console.log(
    'PASS Qwen: native tool calls really close/open the data panel and return successful outputs',
  );
  assert.equal(await page.evaluate(() => voiceQa.start('doubao')), 'listening');
  await page.evaluate(() => voiceQa.controller.sendTextCommand('关闭数据面板'));
  await page.waitForFunction(
    () =>
      document.getElementById('data-panel').classList.contains('collapsed') &&
      voiceQa.socket.sent.some(
        (data) => voiceQa.decodeServerFrame(data).event === 500,
      ),
  );
  assert.ok(
    await page.evaluate(() =>
      voiceQa.requests.some((body) =>
        body.messages.some(
          (message) =>
            message.role === 'tool' && JSON.parse(message.content).ok,
        ),
      ),
    ),
  );
  await page.evaluate(() => {
    for (const [event, payload] of [
      [350, { tts_type: 'chat_tts_text' }],
      [359, {}],
      [450, {}],
      [451, { results: [{ text: '打开数据面板', is_interim: false }] }],
      [459, {}],
    ])
      voiceQa.socket.emit(voiceQa.encodeJsonFrame(event, payload).buffer);
  });
  await page.waitForFunction(
    () =>
      !document.getElementById('data-panel').classList.contains('collapsed'),
  );
  console.log(
    'PASS Doubao: typed input and ASR both execute app controls through Qwen, then request result TTS',
  );
  await page.evaluate(() => voiceQa.controller.stop());
} finally {
  await browser.close();
}
