import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The managed Caddy block must upstream the serving slot (one port between
 * deploys), accept both ports for the hand-over, and leave every site it does
 * not own byte for byte. Getting either wrong either breaks the no-outage
 * switch or someone else's site on the same host.
 */

const SCRIPT = fileURLToPath(
  new URL('../scripts/write-caddy-block.py', import.meta.url),
);
const BEGIN = '# >>> gods-eye-view (managed) >>>';
const END = '# <<< gods-eye-view <<<';

function withFile(contents, callback) {
  const dir = mkdtempSync(join(tmpdir(), 'caddy-'));
  const file = join(dir, 'Caddyfile');
  try {
    writeFileSync(file, contents);
    return callback(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function write(file, ports) {
  execFileSync('python3', [
    SCRIPT,
    file,
    BEGIN,
    END,
    'godseye.example',
    ports,
    '4180',
    '/webhook',
  ]);
}

function run(contents, { ports = '4174' } = {}) {
  return withFile(contents, (file) => {
    write(file, ports);
    return readFileSync(file, 'utf8');
  });
}

test('one serving slot is the only app upstream between deploys', () => {
  const out = run('{\n}\n');
  assert.match(out, /reverse_proxy 127\.0\.0\.1:4174 \{/);
  assert.doesNotMatch(out, /127\.0\.0\.1:4173/);
});

test('both ports can upstream the block during a hand-over', () => {
  const out = run('{\n}\n', { ports: '4173,4174' });
  assert.match(out, /reverse_proxy 127\.0\.0\.1:4173 127\.0\.0\.1:4174 \{/);
});

test('the upstream is health-checked and retries', () => {
  const out = run('{\n}\n');
  assert.match(out, /health_uri \//);
  assert.match(out, /health_interval/);
  assert.match(out, /lb_try_duration/);
});

test('an existing site is preserved untouched', () => {
  const other = 'other.example {\n\trespond "hi"\n}\n';
  const out = run(other);
  assert.ok(out.startsWith(other), 'another site must survive unchanged');
});

test('existing site line endings and trailing whitespace are preserved', () => {
  const other = 'other.example {\r\n\trespond "hi"\r\n}\r\n\t\r\n';
  assert.ok(
    run(other).startsWith(other),
    'all existing site bytes survive unchanged',
  );
});

test('re-running replaces the block instead of appending a second one', () => {
  const once = run('{\n}\n');
  const twice = run(once);
  assert.equal(
    twice.split(BEGIN).length - 1,
    1,
    'the block appears exactly once',
  );
  assert.equal(twice, once, 'the complete file is stable on a second run');
});

test('custom slot ports are written verbatim', () => {
  const out = run('{\n}\n', { ports: '5000,5001' });
  assert.match(out, /reverse_proxy 127\.0\.0\.1:5000 127\.0\.0\.1:5001 \{/);
});

test('a malformed port list is refused instead of written', () => {
  assert.throws(() =>
    withFile('{\n}\n', (file) => write(file, '5000,not-a-port')),
  );
  assert.throws(() => withFile('{\n}\n', (file) => write(file, '')));
});
