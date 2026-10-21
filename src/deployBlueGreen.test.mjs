import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * A deploy must never leave the site with zero upstreams. The old flow ran
 * `systemctl restart` on the single instance, so for the length of a process
 * start every request met a closed port.
 *
 * The installer now runs two slots behind Caddy: the new release starts on the
 * idle one, is health-checked, and only then is the old one retired. These
 * tests pin the parts of that contract a future edit could quietly undo.
 */

const script = readFileSync(
  new URL('../scripts/install-vps.sh', import.meta.url),
  'utf8',
);

test('two slots are configured, one above the other', () => {
  assert.match(script, /GEV_PORT_B=/, 'a second slot port must exist');
  assert.match(
    script,
    /GEV_PORT_B="\$\{GEV_PORT_B:-\$\{GEV_PORT_SLOT_B:-\$\(\(GEV_PORT \+ 1\)\)\}\}"/,
    'the idle slot defaults to the next port',
  );
});

test('Caddy proxies both slots with health checks and retries', () => {
  assert.match(
    script,
    /reverse_proxy 127\.0\.0\.1:\{port\} 127\.0\.0\.1:\{port_b\}/,
    'both slots must be upstreams of the same handler',
  );
  assert.match(script, /lb_try_duration/, 'a mid-restart slot needs a retry');
  assert.match(script, /health_uri \//, 'Caddy must probe each slot');
  assert.match(script, /health_interval/, 'a stopped slot has to be rechecked');
});

test('the new release starts on the idle slot before the old one stops', () => {
  const startIdle = script.indexOf('systemctl start "gev@$IDLE_PORT.service"');
  const stopLive = script.indexOf('systemctl stop "gev@$LIVE_PORT.service"');
  assert.ok(startIdle > 0, 'the idle slot is started explicitly');
  assert.ok(stopLive > 0, 'the live slot is retired explicitly');
  assert.ok(
    startIdle < stopLive,
    'the live slot is stopped only after the idle one is started',
  );
});

test('the idle slot must answer before it becomes live', () => {
  const healthCheck = script.indexOf('http://127.0.0.1:$IDLE_PORT/');
  const switchOver = script.indexOf('Switching traffic to $IDLE_PORT');
  assert.ok(healthCheck > 0, 'the new slot is health-checked');
  assert.ok(
    healthCheck < switchOver,
    'the health check runs before traffic is declared switched',
  );
  assert.match(
    script,
    /failed its health check; the previous release is still serving/,
    'a failed health check must leave the running release serving',
  );
});

test('the single-instance unit from older installers is retired', () => {
  assert.match(script, /systemctl disable --now gev\.service/);
  assert.doesNotMatch(
    script,
    /systemctl restart gev\.service/,
    'restarting the one instance is the outage this replaces',
  );
});

test('the slot that serves is recorded so a rerun resumes', () => {
  assert.match(script, /SLOT_FILE=/, 'the live slot must be persisted');
  assert.match(script, /GEV_LIVE_PORT=/, 'the slot file records the live port');
});
