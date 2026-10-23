import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

/**
 * A deploy must never leave the site with zero upstreams, and the host must not
 * keep a second copy of the app resident between deploys.
 *
 * The installer runs two slots: the new release starts on the idle one, is
 * health-checked, then Caddy is pointed at it and only after that is the old
 * one stopped. Steady state is a single serving slot. These tests pin the parts
 * of that contract a future edit could quietly undo.
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

test('the old slot keeps answering until the new one passes its probe', () => {
  // A redeploy must not point Caddy at a cold port: the only pre-start Caddy
  // write belongs to the first-install branch, where nothing is serving yet.
  assert.match(script, /write-caddy-block\.py/);
  assert.match(script, /install_caddy_site "\$IDLE_PORT"/);

  const firstInstall = script.indexOf('live_serving=0');
  const firstWrite = script.indexOf('install_caddy_site "$IDLE_PORT"');
  const healthCheck = script.indexOf('http://127.0.0.1:$IDLE_PORT/');
  const switched = script.lastIndexOf('install_caddy_site "$IDLE_PORT"');
  const stopOld = script.indexOf('systemctl stop "gev@$LIVE_PORT.service"');

  assert.ok(firstInstall > 0, 'the deploy records whether a release serves');
  assert.ok(
    firstWrite > firstInstall,
    'the pre-start Caddy write happens only when nothing serves',
  );
  assert.ok(
    healthCheck < switched,
    'Caddy is pointed at the new slot only after it answered',
  );
  assert.ok(
    switched < stopOld,
    'the old slot is stopped only after Caddy moved to the new one',
  );
});

test('the retired slot is stopped and stays disabled', () => {
  // Keeping an idle process resident doubles the airport directory in RAM,
  // which is the memory this release reclaims.
  assert.match(
    script,
    /systemctl stop "gev@\$LIVE_PORT\.service"/,
    'the slot that stopped serving must be stopped',
  );
  assert.match(
    script,
    /systemctl disable "gev@\$LIVE_PORT\.service"/,
    'a reboot must not restart the retired slot',
  );
  assert.match(
    script,
    /systemctl enable "gev@\$IDLE_PORT\.service"/,
    'the serving slot must come back after a reboot',
  );
  assert.doesNotMatch(script, /refreshed as standby/);
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

test('the idle slot starts without touching the live one', () => {
  const start = script.indexOf(
    'log "Bringing the new release up on the idle slot',
  );
  const end = script.indexOf('idle_healthy=""', start);
  assert.ok(start > 0 && end > start);
  const command = script.slice(start, end);
  const harness = `
set -e
IDLE_PORT=4174
idle_loaded=previous
live_loaded=previous
log() { :; }
systemctl() {
  [ "$2" = "gev@4174.service" ] || { echo 'live slot touched too early'; exit 9; }
  case "$1" in
    start) : ;; # An already-running systemd unit keeps its previous process.
    restart) idle_loaded=new ;;
    stop) idle_loaded=stopped ;;
    *) exit 10 ;;
  esac
}
${command}
[ "$idle_loaded" = new ] || { echo 'standby still serves the previous backend'; exit 11; }
[ "$live_loaded" = previous ]
`;
  const bash =
    process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  const result = spawnSync(bash, ['--noprofile', '--norc', '-c', harness], {
    encoding: 'utf8',
  });
  assert.equal(
    result.status,
    0,
    result.stderr || result.stdout || result.error?.message,
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
