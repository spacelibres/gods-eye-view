import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  mkdirSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const receiver = fileURLToPath(new URL('./webhook.js', import.meta.url));
const secret = 'local-fixture-secret';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(25);
  }
  assert.fail(message);
}

function harness(t) {
  const dir = mkdtempSync(join(tmpdir(), 'gev-webhook-'));
  const state = join(dir, 'private', 'pending.json');
  const records = join(dir, 'runs.jsonl');
  const fixture = join(dir, 'fixture.cjs');
  const installer = join(dir, 'installer.sh');
  writeFileSync(installer, 'exec "$TEST_NODE" "$TEST_FIXTURE"\n');
  writeFileSync(
    fixture,
    `
const fs = require('node:fs');
const path = require('node:path');
const file = process.env.TEST_RECORDS;
const n = fs.existsSync(file) ? fs.readFileSync(file,'utf8').trim().split('\\n').length : 0;
let intent; try { intent=JSON.parse(fs.readFileSync(process.env.GEV_WEBHOOK_STATE_FILE,'utf8')); } catch {}
fs.appendFileSync(file, JSON.stringify({pid:process.pid,managed:process.env.GEV_WEBHOOK_MANAGED,after:intent?.after})+'\\n');
const gate=path.join(process.env.TEST_DIR,'release-'+n);
const timer=setInterval(()=>{ if(fs.existsSync(gate)){clearInterval(timer);process.exit(fs.readFileSync(gate,'utf8')==='fail'?7:0)} },20);
`,
  );
  const children = [];
  const runs = () =>
    existsSync(records)
      ? readFileSync(records, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map(JSON.parse)
      : [];
  async function start() {
    const probe = createServer();
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const availablePort = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const child = spawn(process.execPath, [receiver], {
      env: {
        ...process.env,
        PATH:
          process.platform === 'win32'
            ? `C:/Program Files/Git/bin;${process.env.PATH}`
            : process.env.PATH,
        GEV_WEBHOOK_SECRET: secret,
        GEV_WEBHOOK_PORT: String(availablePort),
        GEV_WEBHOOK_STATE_FILE: state,
        GEV_INSTALLER: installer.replaceAll('\\', '/'),
        TEST_NODE: process.execPath.replaceAll('\\', '/'),
        TEST_FIXTURE: fixture.replaceAll('\\', '/'),
        TEST_RECORDS: records,
        TEST_DIR: dir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let output = '';
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      output += data;
    });
    child.done = new Promise((resolve) =>
      child.once('exit', (code, signal) => resolve({ code, signal })),
    );
    const port = await until(
      () =>
        /webhook listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(output)?.[1],
      'receiver should listen',
    );
    child.base = `http://127.0.0.1:${port}`;
    return child;
  }
  async function post(
    child,
    after,
    {
      signed = true,
      ref = 'refs/heads/main',
      repository = 'spacelibres/gods-eye-view',
    } = {},
  ) {
    const body = JSON.stringify({
      ref,
      after,
      repository: { full_name: repository },
    });
    const response = await fetch(child.base + '/webhook', {
      method: 'POST',
      headers: {
        'x-github-event': 'push',
        'x-hub-signature-256': signed
          ? 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
          : 'invalid',
      },
      body,
    });
    await response.text();
    return response.status;
  }
  function stop(child) {
    child.kill('SIGKILL');
    for (const run of runs()) {
      try {
        process.kill(run.pid, 'SIGKILL');
      } catch {}
    }
  }
  t.after(async () => {
    for (const child of children) stop(child);
    await Promise.all(children.map((child) => child.done));
    await delay(100);
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    dir,
    state,
    runs,
    start,
    post,
    stop,
    release: (n, value = '') => writeFileSync(join(dir, 'release-' + n), value),
  };
}

test('accepted latest push survives receiver termination and refreshes after recovery', async (t) => {
  const h = harness(t);
  const first = await h.start();
  assert.equal(await h.post(first, 'first'), 202);
  await until(() => h.runs().length === 1, 'first installer starts');
  assert.equal(await h.post(first, 'latest'), 202);
  assert.equal(
    JSON.parse(readFileSync(h.state, 'utf8')).after,
    'latest',
    '202 follows durable intent',
  );
  if (process.platform !== 'win32') {
    const file = statSync(h.state);
    const directory = statSync(dirname(h.state));
    assert.equal(file.mode & 0o777, 0o600, 'checkpoint file is private');
    assert.equal(
      directory.mode & 0o777,
      0o700,
      'checkpoint directory is private',
    );
    assert.equal(
      file.uid,
      process.getuid(),
      'checkpoint belongs to service user',
    );
    assert.equal(
      directory.uid,
      process.getuid(),
      'state directory belongs to service user',
    );
  }
  h.stop(first);
  await first.done;
  const recovered = await h.start();
  await until(() => h.runs().length === 2, 'restart resumes accepted work');
  assert.equal(h.runs()[1].after, 'latest');
  assert.equal(h.runs()[1].managed, '1');
  h.release(1);
  assert.deepEqual(await recovered.done, { code: 0, signal: null });
  assert.equal(existsSync(h.state), false, 'successful intent is consumed');
});

test('pushes after a build starts coalesce into a serial follow-up before receiver refresh', async (t) => {
  const h = harness(t);
  const child = await h.start();
  assert.equal(await h.post(child, 'first'), 202);
  await until(() => h.runs().length === 1, 'first installer starts');
  assert.equal(await h.post(child, 'middle'), 202);
  assert.equal(await h.post(child, 'latest'), 202);
  assert.equal(h.runs().length, 1);
  h.release(0);
  await until(() => h.runs().length === 2, 'follow-up starts');
  assert.equal(h.runs()[1].after, 'latest');
  h.release(1);
  assert.deepEqual(await child.done, { code: 0, signal: null });
  assert.equal(h.runs().length, 2);
});

test('failed installer remains pending without retry spin and succeeds on restart', async (t) => {
  const h = harness(t);
  const child = await h.start();
  assert.equal(await h.post(child, 'retry'), 202);
  await until(() => h.runs().length === 1, 'installer starts');
  h.release(0, 'fail');
  await until(
    async () =>
      (await (await fetch(child.base + '/webhook/health')).json()).lastRun
        ?.ok === false,
    'failure visible',
  );
  await delay(150);
  assert.equal(h.runs().length, 1);
  assert.equal(JSON.parse(readFileSync(h.state, 'utf8')).after, 'retry');
  h.stop(child);
  await child.done;
  const recovered = await h.start();
  await until(() => h.runs().length === 2, 'restart retries persisted failure');
  h.release(1);
  await recovered.done;
  assert.equal(existsSync(h.state), false);
});

test('authentication and repository gates precede persistence', async (t) => {
  const h = harness(t);
  const child = await h.start();
  assert.equal(await h.post(child, 'bad', { signed: false }), 401);
  assert.equal(await h.post(child, 'other', { ref: 'refs/heads/other' }), 202);
  assert.equal(await h.post(child, 'other', { repository: 'other/repo' }), 202);
  assert.equal(existsSync(h.state), false);
  assert.equal(h.runs().length, 0);
});

test('malformed recovery state fails closed without spawning an installer', async (t) => {
  const h = harness(t);
  mkdirSync(dirname(h.state), { recursive: true });
  writeFileSync(
    h.state,
    JSON.stringify({
      id: 'fake',
      ref: 'refs/heads/other',
      repository: 'other/repo',
      after: 'untrusted',
    }),
  );
  const child = await h.start();
  const health = await (await fetch(child.base + '/webhook/health')).json();
  assert.equal(health.ok, false);
  assert.equal(await h.post(child, 'valid'), 503);
  assert.equal(h.runs().length, 0);
});

test('a checkpoint write failure refuses 202 and reports unhealthy state', async (t) => {
  const h = harness(t);
  const child = await h.start();
  writeFileSync(dirname(h.state), 'blocking parent directory creation');
  assert.equal(await h.post(child, 'cannot-persist'), 503);
  assert.equal(
    (await (await fetch(child.base + '/webhook/health')).json()).ok,
    false,
  );
  assert.equal(h.runs().length, 0);
});

test('only manual installer runs restart the webhook systemd cgroup', () => {
  const script = readFileSync(
    new URL('../scripts/install-vps.sh', import.meta.url),
    'utf8',
  );
  const command = script.match(
    /if \[ "\$\{GEV_WEBHOOK_MANAGED:-\}" != "1" \]; then\n\s+systemctl restart gev-webhook.service\nfi/,
  )?.[0];
  assert.ok(
    command,
    'installer must defer its own cgroup restart when managed',
  );
  const bash =
    process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  for (const [managed, expected] of [
    ['1', ''],
    ['', 'restart gev-webhook.service'],
  ]) {
    const result = spawnSync(
      bash,
      [
        '--noprofile',
        '--norc',
        '-c',
        `systemctl() { printf '%s %s' "$1" "$2"; }\n${command}`,
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, GEV_WEBHOOK_MANAGED: managed },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, expected);
  }
});
