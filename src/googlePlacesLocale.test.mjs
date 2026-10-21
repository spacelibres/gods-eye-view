import assert from 'node:assert/strict';
import test from 'node:test';
import { googlePlacesContextProxy } from '../server/providers/places/google.js';

/**
 * Places results must come back in the language the app is running in, not in
 * the language of whichever country happens to host the server or whichever
 * region the request's IP resolves to. The client names its locale; the proxy
 * forwards it as Google's `languageCode`.
 */

function installRoutes({ fetchImpl, resolveApiKey = () => 'test-key' } = {}) {
  const routes = new Map();
  googlePlacesContextProxy({
    resolveApiKey,
    fetchImpl,
  }).configureServer({
    middlewares: {
      use(path, handler) {
        routes.set(path, handler);
      },
    },
  });
  return routes;
}

function invoke(handler, { method = 'GET', url = '/', remoteAddress = 'lang-test' } = {}) {
  return new Promise((resolve, reject) => {
    const headers = new Map();
    const req = { method, url, headers: {}, socket: { remoteAddress } };
    const res = {
      statusCode: 200,
      setHeader(name, value) {
        headers.set(String(name).toLowerCase(), String(value));
      },
      end(body = '') {
        resolve({
          statusCode: this.statusCode,
          body: body ? JSON.parse(String(body)) : null,
        });
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

function captureBodies() {
  const bodies = [];
  const fetchImpl = async (url, init) => {
    bodies.push({ url, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({ places: [] }),
      text: async () => '{"places":[]}',
    };
  };
  return { bodies, fetchImpl };
}

test('nearby-places forwards the requested locale as Google languageCode', async () => {
  const { bodies, fetchImpl } = captureBodies();
  const routes = installRoutes({ fetchImpl });

  await invoke(routes.get('/api/google/nearby-places'), {
    url: '/?lat=39.9042&lon=116.4074&radiusM=1000&lang=zh-CN',
  });

  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].body.languageCode, 'zh-CN');
});

test('text-search forwards the requested locale as Google languageCode', async () => {
  const { bodies, fetchImpl } = captureBodies();
  const routes = installRoutes({ fetchImpl });

  await invoke(routes.get('/api/google/text-search'), {
    url: '/?q=%E5%A4%A9%E5%AE%89%E9%97%A8&lat=39.9042&lon=116.4074&lang=ja',
  });

  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].body.languageCode, 'ja');
});

test('every shipped locale survives the round trip unchanged', async () => {
  for (const locale of ['en', 'es', 'ru', 'zh-CN', 'zh-TW', 'ja', 'ko']) {
    const { bodies, fetchImpl } = captureBodies();
    const routes = installRoutes({ fetchImpl });
    await invoke(routes.get('/api/google/nearby-places'), {
      url: `/?lat=0&lon=0&lang=${encodeURIComponent(locale)}`,
    });
    assert.equal(bodies[0].body.languageCode, locale);
  }
});

test('an absent, blank, or malformed locale is dropped rather than forwarded', async () => {
  const cases = [
    'lat=0&lon=0',
    'lat=0&lon=0&lang=',
    'lat=0&lon=0&lang=%20%20',
    'lat=0&lon=0&lang=not%20a%20tag!',
    'lat=0&lon=0&lang=<script>',
    `lat=0&lon=0&lang=${'x'.repeat(40)}`,
  ];
  for (const query of cases) {
    const { bodies, fetchImpl } = captureBodies();
    const routes = installRoutes({ fetchImpl });
    const result = await invoke(routes.get('/api/google/nearby-places'), {
      url: `/?${query}`,
    });
    assert.equal(result.statusCode, 200, query);
    assert.equal(
      Object.hasOwn(bodies[0].body, 'languageCode'),
      false,
      `${query || '(none)'} must not reach Google as a languageCode`,
    );
  }
});

test('a keyless server never consults the locale', async () => {
  const { bodies, fetchImpl } = captureBodies();
  const routes = installRoutes({ fetchImpl, resolveApiKey: () => '' });
  const result = await invoke(routes.get('/api/google/nearby-places'), {
    url: '/?lat=0&lon=0&lang=zh-CN',
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.configured, false);
  assert.equal(bodies.length, 0);
});
