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

import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

const SECRET = process.env.GEV_WEBHOOK_SECRET || '';
const PORT = Number(process.env.GEV_WEBHOOK_PORT || 4180);
const HOST = process.env.GEV_WEBHOOK_HOST || '127.0.0.1';
const PATH = process.env.GEV_WEBHOOK_PATH || '/webhook';
const BRANCH = process.env.GEV_BRANCH || 'main';
const INSTALLER =
  process.env.GEV_INSTALLER || '/opt/gods-eye-view/scripts/install-vps.sh';
const MAX_BODY = 25 * 1024 * 1024; // GitHub caps pushes at 25 MB
const REPOSITORY = process.env.GEV_REPOSITORY || 'spacelibres/gods-eye-view';
const STATE_FILE =
  process.env.GEV_WEBHOOK_STATE_FILE ||
  '/var/lib/gods-eye-view-webhook/pending.json';

const log = (...parts) => console.log(new Date().toISOString(), ...parts);

let running = false;
let queued = false;
let lastRun = null;
let pending = null;
let stateError = null;
let refreshing = false;

function privateFile(path, directory = false) {
  const stat = lstatSync(path);
  if (
    stat.isSymbolicLink() ||
    (directory ? !stat.isDirectory() : !stat.isFile()) ||
    (process.platform !== 'win32' &&
      ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()))
  ) {
    throw new Error(
      'deployment state must be private and owned by the service',
    );
  }
}

function syncDirectory(path) {
  // Windows does not support opening directories for fsync. Production runs
  // on Linux, where syncing the rename/unlink makes the checkpoint durable.
  if (process.platform === 'win32') return;
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function saveIntent(intent) {
  const directory = dirname(STATE_FILE);
  let created = false;
  try {
    mkdirSync(directory, { mode: 0o700 });
    created = true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  privateFile(directory, true);
  if (created) syncDirectory(dirname(directory));
  const temporary = `${STATE_FILE}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, JSON.stringify(intent));
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, STATE_FILE);
    syncDirectory(directory);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try {
      unlinkSync(temporary);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function validIntent(intent) {
  return (
    intent &&
    typeof intent.id === 'string' &&
    /^[0-9a-f-]{36}$/.test(intent.id) &&
    intent.ref === `refs/heads/${BRANCH}` &&
    intent.repository === REPOSITORY &&
    typeof intent.after === 'string' &&
    intent.after.length > 0 &&
    intent.after.length <= 128
  );
}

try {
  privateFile(dirname(STATE_FILE), true);
  privateFile(STATE_FILE);
  pending = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  if (!validIntent(pending) || !SECRET)
    throw new Error('invalid deployment checkpoint');
  queued = true;
} catch (error) {
  if (error.code !== 'ENOENT') {
    pending = null;
    stateError = 'deployment state unavailable; operator intervention required';
    log(stateError);
  }
}

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
 * Run one installer at a time. The durable latest intent coalesces pushes
 * arriving during each run; failed work remains available for recovery.
 */
async function deploy() {
  if (running) {
    queued = true;
    log('deploy already running; queued one follow-up');
    return;
  }
  running = true;
  try {
    do {
      queued = false;
      const intent = pending;
      const { ref, after } = intent;
      const started = Date.now();
      lastRun = { ref, after, started: new Date().toISOString(), ok: null };
      log(`deploying ${ref} (${String(after).slice(0, 8)})`);
      const child = spawn('bash', [INSTALLER], {
        stdio: ['ignore', 'inherit', 'inherit'],
        env: { ...process.env, GEV_BRANCH: BRANCH, GEV_WEBHOOK_MANAGED: '1' },
      });
      const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });
      lastRun.ok = code === 0;
      lastRun.seconds = Math.round((Date.now() - started) / 1000);
      log(`deploy finished with ${code} in ${lastRun.seconds}s`);
      if (pending.id === intent.id) {
        if (code !== 0) break; // Preserve failed work, without a retry loop.
        try {
          unlinkSync(STATE_FILE);
          syncDirectory(dirname(STATE_FILE));
        } catch (error) {
          stateError =
            'deployment state unavailable; operator intervention required';
          throw error;
        }
        pending = null;
      }
    } while (pending);
  } catch (error) {
    lastRun = {
      ...lastRun,
      ok: false,
      error: 'deployment failed; check service logs',
    };
    log('deploy failed', error.code || error.name);
  } finally {
    running = false;
    queued = false;
    if (!pending && !stateError && !refreshing) {
      // The installer cannot restart its own systemd cgroup. Drain first and
      // let Restart=always reload the receiver from the updated checkout.
      // A request already in flight is still checkpointed before its 202;
      // startup replays it even if this close races with its installer.
      refreshing = true;
      log('deploy queue drained; refreshing webhook receiver');
      server.close(() => process.exit(0));
    }
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
      JSON.stringify({
        ok: !stateError,
        running,
        queued,
        lastRun,
        branch: BRANCH,
        pending: Boolean(pending),
        stateError,
      }),
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

  const intent = {
    id: randomUUID(),
    repository: REPOSITORY,
    ref: payload.ref,
    after: payload.after,
  };
  if (!validIntent(intent)) {
    response.writeHead(400).end('invalid push');
    return;
  }
  if (stateError) {
    response.writeHead(503).end('deployment state unavailable');
    return;
  }
  try {
    saveIntent(intent);
    pending = intent;
  } catch {
    stateError = 'deployment state unavailable; operator intervention required';
    log(stateError);
    response.writeHead(503).end('deployment state unavailable');
    return;
  }

  // Answer first: GitHub expects a fast reply, and the build can take minutes.
  response.writeHead(202).end('deploy queued');
  void deploy();
});

server.listen(PORT, HOST, () => {
  log(`webhook listening on http://${HOST}:${PORT}${PATH}`);
  log(`branch ${BRANCH}, installer ${INSTALLER}`);
  if (!SECRET)
    log(
      'WARNING: GEV_WEBHOOK_SECRET is unset; every deploy request is refused',
    );
  if (pending && !stateError) {
    log('resuming checkpointed deployment');
    void deploy();
  }
});
