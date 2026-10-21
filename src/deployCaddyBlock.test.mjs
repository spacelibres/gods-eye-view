import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The managed Caddy block must upstream BOTH deploy slots, and must leave every
 * site it does not own byte for byte. Getting either wrong either removes the
 * no-outage switch or breaks someone else's site on the same host.
 */

const SCRIPT = new URL('../scripts/write-caddy-block.py', import.meta.url).pathname;
const BEGIN = '# >>> gods-eye-view (managed) >>>';
const END = '# <<< gods-eye-view <<<';

function run(contents, { portA = '4173', portB = '4174' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'caddy-'));
  const file = join(dir, 'Caddyfile');
  writeFileSync(file, contents);
  execFileSync('python3', [
    SCRIPT,
    file,
    BEGIN,
    END,
    'godseye.example',
    portA,
    portB,
    '4180',
    '/webhook',
  ]);
  return readFileSync(file, 'utf8');
}

test('both slots are upstreams of the app handler', () => {
  const out = run('{\n}\n');
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

test('re-running replaces the block instead of appending a second one', () => {
  const once = run('{\n}\n');
  const dir = mkdtempSync(join(tmpdir(), 'caddy-'));
  const file = join(dir, 'Caddyfile');
  writeFileSync(file, once);
  execFileSync('python3', [
    SCRIPT,
    file,
    BEGIN,
    END,
    'godseye.example',
    '4173',
    '4174',
    '4180',
    '/webhook',
  ]);
  const twice = readFileSync(file, 'utf8');
  assert.equal(twice.split(BEGIN).length - 1, 1, 'the block appears exactly once');
});

test('custom slot ports are written verbatim', () => {
  const out = run('{\n}\n', { portA: '5000', portB: '5001' });
  assert.match(out, /reverse_proxy 127\.0\.0\.1:5000 127\.0\.0\.1:5001 \{/);
});
