import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer, request } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

for (const proxy of [false, true]) {
  test(`production mounts Gemini through ${proxy ? 'trusted TLS proxy' : 'direct loopback'}`, async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), 'gev-production-voice-'));
    const reserve = createServer();
    reserve.listen(0, '127.0.0.1');
    await once(reserve, 'listening');
    const port = reserve.address().port;
    await new Promise((resolve) => reserve.close(resolve));
    await mkdir(path.join(root, 'dist'));
    await writeFile(
      path.join(root, 'dist/index.html'),
      '<!doctype html><title>fixture</title>',
    );
    const preload = path.join(root, 'no-network.mjs');
    await writeFile(
      preload,
      'globalThis.fetch = async () => Response.json({}, {status:503});',
    );
    const child = spawn(
      process.execPath,
      [
        '--import',
        pathToFileURL(preload).href,
        fileURLToPath(
          new URL('../../server/standalone/serve.js', import.meta.url),
        ),
      ],
      {
        env: {
          ...process.env,
          HOST: '127.0.0.1',
          PORT: String(port),
          GEV_ALLOWED_HOSTS: '127.0.0.1,release-fixture.example',
          GEV_TRUSTED_PROXY: proxy ? '1' : '0',
          GEMINI_API_KEY: '',
          GEV_DIST_DIR: path.join(root, 'dist'),
          GEV_AIRPORTS_STATE_DIR: path.join(root, 'airports'),
          GEV_OPENSKY_STATE_DIR: path.join(root, 'opensky'),
          GEV_ADSB_STATE_DIR: path.join(root, 'adsb'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const closed = once(child, 'close');
    let output = '';
    child.stderr.on('data', () => {});
    t.after(async () => {
      child.kill();
      await closed;
      assert.ok(
        path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep),
      );
      await rm(root, { recursive: true, force: true });
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('production server did not start')),
        15000,
      );
      child.stdout.on('data', (data) => {
        output += data;
        if (output.includes('[serve] API routes')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.once('error', reject);
      child.once('exit', () => {
        clearTimeout(timeout);
        reject(new Error('production server exited before startup'));
      });
    });
    const origin = `http://127.0.0.1:${port}`;
    const headers = proxy
      ? {
          Host: 'release-fixture.example',
          Origin: 'https://release-fixture.example',
          'X-Forwarded-Proto': 'https',
          'X-Forwarded-For': '203.0.113.8',
          'Sec-Fetch-Site': 'same-origin',
          'Content-Type': 'application/json',
        }
      : { Origin: origin, 'Content-Type': 'application/json' };
    const call = (values) =>
      new Promise((resolve, reject) => {
        const req = request(
          `${origin}/api/gemini/token`,
          { method: 'POST', headers: values },
          (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (part) => (data += part));
            res.on('end', () =>
              resolve({ status: res.statusCode, body: JSON.parse(data) }),
            );
          },
        );
        req.on('error', reject);
        req.end('{}');
      });
    const response = await call(headers);
    assert.equal(response.status, 503, JSON.stringify(response.body));
    assert.match(response.body.error, /Gemini API key/);
    const foreign = await call({
      ...headers,
      Origin: 'https://foreign.example',
    });
    assert.equal(foreign.status, 403);
  });
}
