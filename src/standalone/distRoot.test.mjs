import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The standalone server serves whatever `GEV_DIST_DIR` names, defaulting to
 * `dist/`. That indirection is what lets a deploy publish a finished build into
 * its own directory and swap a symlink, instead of rebuilding the tree the
 * process is reading from.
 */

const source = readFileSync(
  new URL('../../server/standalone/serve.js', import.meta.url),
  'utf8',
);

test('the served directory is configurable and defaults to dist', () => {
  assert.match(source, /process\.env\.GEV_DIST_DIR/);
  assert.match(source, /GEV_DIST_DIR\s*\|\|\s*'dist'/);
});

test('the override is resolved against the repository, never the cwd', () => {
  // path.resolve(ROOT, …) keeps an absolute GEV_DIST_DIR as-is and makes a
  // relative one relative to the checkout, which is the only reading that
  // survives being started by systemd with WorkingDirectory elsewhere.
  assert.match(source, /const DIST = path\.resolve\(\s*ROOT,/);
});

test('a blank override falls back instead of resolving to the repository root', () => {
  // String(process.env.X || 'dist').trim() || 'dist' — an empty or whitespace
  // value must not turn DIST into ROOT itself, which would serve the whole
  // checkout (sources, .env, .git).
  assert.match(source, /\.trim\(\)\s*\|\|\s*'dist'/);
});

test('the startup line reports which tree is being served', () => {
  assert.match(source, /\[serve\] serving \$\{DIST\}/);
});
