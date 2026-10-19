import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SERVE = path.join(ROOT, 'server', 'standalone', 'serve.js');

/** A port the OS says is free, released before the child binds it. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** Start the server and resolve once it reports its address. */
async function startServer(port) {
  const child = spawn(process.execPath, [SERVE], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`server did not start: ${out}`)),
      20_000,
    );
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (out.includes(`127.0.0.1:${port}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited ${code}: ${out}`));
    });
  });
  return child;
}

test('the production server serves the build and its API routes', async (t) => {
  const port = await freePort();
  const child = await startServer(port);
  t.after(() => child.kill());
  const base = `http://127.0.0.1:${port}`;

  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);

  // A provider route that `vite preview` never mounted.
  const setup = await fetch(`${base}/api/setup/status`);
  assert.equal(setup.status, 200);
  assert.match(setup.headers.get('content-type'), /application\/json/);

  // Unknown API paths answer JSON rather than falling back to the shell.
  const missing = await fetch(`${base}/api/not-a-route`);
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /Unknown API route/);

  // A client-side route still gets the app shell.
  const deep = await fetch(`${base}/some/deep/link`);
  assert.equal(deep.status, 200);
  assert.match(deep.headers.get('content-type'), /text\/html/);
});
