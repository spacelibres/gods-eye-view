#!/usr/bin/env node
// GitHub webhook receiver for the VPS deployment.
//
//   GEV_WEBHOOK_SECRET=... node server/webhook.js
//
// Listens on 127.0.0.1:$GEV_WEBHOOK_PORT (default 4180) and Caddy proxies
// $GEV_WEBHOOK_PATH (default /webhook) to it. A push to the deployed branch
// runs scripts/install-vps.sh, so the site updates itself.
//
// Safety, in the order the checks run:
//   - the request must carry a valid X-Hub-Signature-256 for the raw body;
//   - the event must be `push` and the ref must match the deployed branch;
//   - only one deployment runs at a time; a push during a run queues at most
//     one follow-up, which coalesces a burst of commits into one rebuild.
//
// No secret in the environment means no requests are accepted, which is the
// safe default for a service that can run a shell command.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const SECRET = process.env.GEV_WEBHOOK_SECRET || '';
const PORT = Number(process.env.GEV_WEBHOOK_PORT || 4180);
const HOST = process.env.GEV_WEBHOOK_HOST || '127.0.0.1';
const PATH = process.env.GEV_WEBHOOK_PATH || '/webhook';
const BRANCH = process.env.GEV_BRANCH || 'main';
const INSTALLER =
  process.env.GEV_INSTALLER || '/opt/gods-eye-view/scripts/install-vps.sh';
const MAX_BODY = 25 * 1024 * 1024; // GitHub caps pushes at 25 MB
const REPOSITORY = process.env.GEV_REPOSITORY || 'spacelibres/gods-eye-view';

const log = (...parts) => console.log(new Date().toISOString(), ...parts);

let running = false;
let queued = false;
let lastRun = null;

/** Constant-time comparison of the signature header with our own HMAC. */
function signatureMatches(raw, header) {
  if (!SECRET || typeof header !== 'string') return false;
  const expected = `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

/**
 * Run the installer once. A request that arrives mid-run sets `queued`, and
 * the run repeats once when it finishes, so a burst of commits costs two
 * builds at most and never overlaps.
 */
async function deploy({ ref, after }) {
  if (running) {
    queued = true;
    log('deploy already running; queued one follow-up');
    return;
  }
  running = true;
  const started = Date.now();
  try {
    do {
      queued = false;
      lastRun = { ref, after, started: new Date().toISOString(), ok: null };
      log(`deploying ${ref} (${String(after).slice(0, 8)})`);
      const child = spawn('bash', [INSTALLER], {
        stdio: ['ignore', 'inherit', 'inherit'],
        env: { ...process.env, GEV_BRANCH: BRANCH },
      });
      const code = await new Promise((resolve) => child.on('close', resolve));
      lastRun.ok = code === 0;
      lastRun.seconds = Math.round((Date.now() - started) / 1000);
      log(`deploy finished with ${code} in ${lastRun.seconds}s`);
    } while (queued);
  } catch (error) {
    lastRun = { ...lastRun, ok: false, error: String(error) };
    log('deploy failed:', error);
  } finally {
    running = false;
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  // Caddy forwards both /webhook and /webhook/health here, so match on the
  // prefix and compare the remainder.
  const subpath = url.pathname.startsWith(PATH)
    ? url.pathname.slice(PATH.length)
    : null;

  if (request.method === 'GET' && subpath === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({ ok: true, running, queued, lastRun, branch: BRANCH }),
    );
    return;
  }

  if (subpath === null) {
    response.writeHead(404).end();
    return;
  }
  if (request.method !== 'POST') {
    response.writeHead(405, { allow: 'POST' }).end();
    return;
  }
  if (!SECRET) {
    log('refused: GEV_WEBHOOK_SECRET is not set');
    response.writeHead(503).end('webhook secret not configured');
    return;
  }

  let raw;
  try {
    raw = await readBody(request);
  } catch (error) {
    response.writeHead(413).end(String(error));
    return;
  }

  if (!signatureMatches(raw, request.headers['x-hub-signature-256'])) {
    log('refused: bad signature');
    response.writeHead(401).end('bad signature');
    return;
  }

  const event = request.headers['x-github-event'];
  if (event === 'ping') {
    response.writeHead(200).end('pong');
    return;
  }
  if (event !== 'push') {
    response.writeHead(204).end();
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    response.writeHead(400).end('invalid JSON');
    return;
  }

  const expectedRef = `refs/heads/${BRANCH}`;
  if (payload.ref !== expectedRef) {
    log(`ignored push to ${payload.ref} (deployed: ${expectedRef})`);
    response.writeHead(202).end(`ignored ${payload.ref}`);
    return;
  }
  if (payload.repository?.full_name !== REPOSITORY) {
    log(`ignored push for ${payload.repository?.full_name}`);
    response.writeHead(202).end('ignored repository');
    return;
  }
  if (payload.deleted) {
    log(`ignored deletion of ${payload.ref}`);
    response.writeHead(202).end('ignored deletion');
    return;
  }

  // Answer first: GitHub expects a fast reply, and the build can take minutes.
  response.writeHead(202).end('deploy queued');
  void deploy({ ref: payload.ref, after: payload.after });
});

server.listen(PORT, HOST, () => {
  log(`webhook listening on http://${HOST}:${PORT}${PATH}`);
  log(`branch ${BRANCH}, installer ${INSTALLER}`);
  if (!SECRET)
    log(
      'WARNING: GEV_WEBHOOK_SECRET is unset; every deploy request is refused',
    );
});
