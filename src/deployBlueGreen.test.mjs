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

test('Caddy learns both slots before anything is started or stopped', () => {
  // The template lives in its own script (pinned by deployCaddyBlock.test), so
  // the installer only has to hand it both ports and reload Caddy — but it has
  // to do so first.
  assert.match(script, /write-caddy-block\.py/);
  assert.match(script, /"\$GEV_PORT" "\$GEV_PORT_B"/);
  assert.match(script, /systemctl reload caddy/);

  const caddy = script.indexOf('install_caddy_site\n');
  const startIdle = script.indexOf('systemctl start "gev@$IDLE_PORT.service"');
  assert.ok(caddy > 0, 'the Caddy block is written');
  assert.ok(
    caddy < startIdle,
    'Caddy must know both slots before the new one starts',
  );
});

test('the new release starts on the idle slot before the old one is touched', () => {
  const startIdle = script.indexOf('systemctl start "gev@$IDLE_PORT.service"');
  const standby = script.indexOf('systemctl restart "gev@$LIVE_PORT.service"');
  assert.ok(startIdle > 0, 'the idle slot is started explicitly');
  assert.ok(standby > 0, 'the old slot is refreshed as a standby');
  assert.ok(
    startIdle < standby,
    'the live slot is only touched after the idle one has started',
  );
});

test('both slots stay running so one failure still has an upstream', () => {
  // Retiring the old slot on every deploy leaves a single upstream: one failed
  // health check then has nowhere to retry, which is the 502 this replaces.
  assert.doesNotMatch(
    script,
    /systemctl stop "gev@\$LIVE_PORT\.service"/,
    'the old slot must become a standby, not be stopped',
  );
  assert.match(script, /refreshed as standby/);
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
