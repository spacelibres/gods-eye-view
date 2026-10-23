#!/usr/bin/env bash
# One-command installer for God's Eye View on an Ubuntu host that already runs
# Caddy.
#
#   sudo bash scripts/install-vps.sh
#
# What it does, in order:
#   1. Installs Node 24 through nvm, leaving the system Node.js untouched.
#   2. Clones or updates the repository in $GEV_HOME.
#   3. Installs the locked dependencies and builds the app.
#   4. Runs it under systemd in two slots (127.0.0.1:$GEV_PORT and
#      $GEV_PORT_B) behind Caddy. One slot serves between deploys; a deploy
#      starts the new release on the idle slot, switches Caddy to it, and only
#      then stops the old one, so the hand-over never leaves zero upstreams.
#   5. Installs the GitHub webhook service on 127.0.0.1:$GEV_WEBHOOK_PORT.
#   6. Adds a Caddy site block for $GEV_DOMAIN and reloads Caddy.
#
# Re-running is safe: it updates the checkout, rebuilds and restarts. Existing
# Caddy sites are never rewritten — only the block between the two markers this
# script owns is replaced.
#
# Environment overrides (all optional):
#   GEV_HOME          install directory        default /opt/gods-eye-view
#   GEV_REPO          git remote               default https://github.com/spacelibres/gods-eye-view.git
#   GEV_BRANCH        branch to deploy         default main
#   GEV_DOMAIN        public hostname          default godseye.spacelibre.cn
#   GEV_PORT          slot A port             default 4173
#   GEV_PORT_B        slot B port             default 4174
#   GEV_NODE          nvm Node version         default 24
#   GEV_USER          service account          default gev
#   GEV_WEBHOOK_PORT  webhook port             default 4180
#   GEV_WEBHOOK_PATH  webhook path             default /webhook
#   GEV_WEBHOOK_SECRET  GitHub webhook secret; the service refuses every
#                     request until it is set in /etc/gods-eye-view.env
#   CESIUM_ION_TOKEN  Cesium ion access token for the build (optional). Read
#                     from the environment or, when unset, from
#                     /etc/gods-eye-view.env, so a token stored once survives
#                     every automatic rebuild. The build otherwise falls back
#                     to Cesium's public keyless terrain.
#   GOOGLE_MAPS_API_KEY  Google Maps browser key (optional). Read the same way.
#                     With it the build prefers Google's own 3D tiles host;
#                     without it the app still loads Google 3D through Cesium
#                     ion when an ion token is present.
set -euo pipefail

GEV_HOME="${GEV_HOME:-/opt/gods-eye-view}"
GEV_REPO="${GEV_REPO:-https://github.com/spacelibres/gods-eye-view.git}"
GEV_BRANCH="${GEV_BRANCH:-main}"
GEV_DOMAIN="${GEV_DOMAIN:-godseye.spacelibre.cn}"
GEV_PORT="${GEV_PORT:-4173}"
# Blue/green with one resident process: both slots exist, but only the serving
# one runs between deploys. A deploy starts the new build on the idle slot,
# waits until it answers, points Caddy at it and only then stops the old one,
# so no request meets a closed port while a second copy of the app no longer
# holds a second copy of the airport directory in memory.
GEV_PORT_B="${GEV_PORT_B:-${GEV_PORT_SLOT_B:-$((GEV_PORT + 1))}}"
GEV_NODE="${GEV_NODE:-24}"
GEV_USER="${GEV_USER:-gev}"
GEV_WEBHOOK_PORT="${GEV_WEBHOOK_PORT:-4180}"
GEV_WEBHOOK_PATH="${GEV_WEBHOOK_PATH:-/webhook}"
GEV_ENV_FILE="${GEV_ENV_FILE:-/etc/gods-eye-view.env}"

# A push replaces this file while it is still running. Keep the version that
# started so the source update can tell the two apart (see the re-exec below).
GEV_SELF_COPY="$(mktemp)"
cp -f "${BASH_SOURCE[0]}" "$GEV_SELF_COPY" 2>/dev/null || GEV_SELF_COPY=""
trap '[ -n "$GEV_SELF_COPY" ] && rm -f "$GEV_SELF_COPY"' EXIT
# Releases are built into their own directory and only become the live one
# after they finish, so a rebuild never leaves the host serving a half-written
# tree. GEV_RELEASES holds the published builds; GEV_CURRENT is the symlink the
# service reads, swapped in one rename.
GEV_RELEASES="${GEV_RELEASES:-$GEV_HOME/releases}"
GEV_CURRENT="${GEV_CURRENT:-$GEV_HOME/current}"

# Build-time credentials. The env file is the durable home for them: the
# webhook rebuilds in a fresh shell with only this file loaded, so a value
# exported by hand would be lost on the next push.
if [ -f "$GEV_ENV_FILE" ]; then
  if [ -z "${CESIUM_ION_TOKEN:-}" ]; then
    CESIUM_ION_TOKEN="$(sed -n 's/^CESIUM_ION_TOKEN=//p' "$GEV_ENV_FILE" | tail -n 1)"
  fi
  if [ -z "${GOOGLE_MAPS_API_KEY:-}" ]; then
    GOOGLE_MAPS_API_KEY="$(sed -n 's/^GOOGLE_MAPS_API_KEY=//p' "$GEV_ENV_FILE" | tail -n 1)"
  fi
fi
export CESIUM_ION_TOKEN="${CESIUM_ION_TOKEN:-}"
export GOOGLE_MAPS_API_KEY="${GOOGLE_MAPS_API_KEY:-}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
BEGIN_MARK="# >>> gods-eye-view (managed by scripts/install-vps.sh) >>>"
END_MARK="# <<< gods-eye-view <<<"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run this as root (sudo bash scripts/install-vps.sh)"
[ -f "$CADDYFILE" ] || die "$CADDYFILE not found; this script expects Caddy to be installed"

install_caddy_site() {
  local upstreams="$1"
  log "Caddy site for $GEV_DOMAIN (upstream $upstreams)"
  # Strip the previous managed block, then append the current one. Everything
  # outside the markers — the existing sites — is kept byte for byte.
  python3 "$GEV_HOME/scripts/write-caddy-block.py" \
    "$CADDYFILE" "$BEGIN_MARK" "$END_MARK" "$GEV_DOMAIN" \
    "$upstreams" "$GEV_WEBHOOK_PORT" "$GEV_WEBHOOK_PATH"

  caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null ||
    die "Caddy rejected the new configuration; nothing was reloaded"
  # A failed reload leaves the previous configuration serving, so dying here is
  # safer than continuing to a step that retires the slot that config points at.
  systemctl reload caddy ||
    die "Caddy failed to reload; the previous configuration is still serving"
  log "Caddy reloaded"
}


# ---------------------------------------------------------------- Node 24 ---
# The service runs as an unprivileged user, which cannot read /root — where
# nvm installs by default. A dedicated prefix keeps the app's Node separate
# from the system one and readable by the service account.
GEV_NODE_DIR="${GEV_NODE_DIR:-/opt/node$GEV_NODE}"
log "Node.js $GEV_NODE in $GEV_NODE_DIR (the system Node.js is left alone)"
if [ ! -x "$GEV_NODE_DIR/bin/node" ]; then
  arch="$(uname -m)"
  case "$arch" in
    x86_64) node_arch=x64 ;;
    aarch64 | arm64) node_arch=arm64 ;;
    *) die "unsupported architecture: $arch" ;;
  esac
  # Resolve the newest 24.x release from the official index rather than
  # pinning a version that would go stale in this file.
  node_version="$(curl -fsSL https://nodejs.org/dist/index.json |
    python3 -c "import json,sys; v=[r['version'] for r in json.load(sys.stdin) if r['version'].startswith('v%s.' % '$GEV_NODE')]; print(v[0])")"
  [ -n "$node_version" ] || die "could not resolve a Node $GEV_NODE release"
  log "installing $node_version from nodejs.org"
  tmp="$(mktemp -d)"
  # The .tar.gz avoids depending on xz, which a slim image may not ship.
  curl -fsSL "https://nodejs.org/dist/$node_version/node-$node_version-linux-$node_arch.tar.gz" |
    tar -xz -C "$tmp"
  mkdir -p "$GEV_NODE_DIR"
  cp -a "$tmp/node-$node_version-linux-$node_arch/." "$GEV_NODE_DIR/"
  rm -rf "$tmp"
fi
NODE_BIN="$GEV_NODE_DIR/bin/node"
NODE_DIR="$GEV_NODE_DIR/bin"
chmod -R a+rX "$GEV_NODE_DIR"
log "Node $("$NODE_BIN" -v) at $NODE_BIN"

# ------------------------------------------------------------ service user ---
log "Service account $GEV_USER"
if ! id -u "$GEV_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "$GEV_USER"
fi

# -------------------------------------------------------------- source tree ---
log "Source in $GEV_HOME ($GEV_BRANCH)"
# Root runs git on a tree owned by the service account; without this Git
# refuses the directory as dubiously owned.
git config --global --add safe.directory "$GEV_HOME"
if [ -d "$GEV_HOME/.git" ]; then
  git -C "$GEV_HOME" fetch --quiet origin "$GEV_BRANCH"
  git -C "$GEV_HOME" checkout --quiet "$GEV_BRANCH"
  git -C "$GEV_HOME" reset --hard --quiet "origin/$GEV_BRANCH"
else
  mkdir -p "$GEV_HOME"
  git clone --quiet --branch "$GEV_BRANCH" "$GEV_REPO" "$GEV_HOME"
fi
chown -R "$GEV_USER:$GEV_USER" "$GEV_HOME"

# `reset --hard` above replaced this script on disk. Bash reads a script
# incrementally, so the rest of this run would continue with the *old* logic —
# the very behaviour a deploy fix is meant to change. Re-exec the checkout's own
# script once, marked so it cannot loop. The copy taken at startup is the
# comparison: by now the file on disk already *is* the new script.
if [ -z "${GEV_REEXEC:-}" ] && [ -s "${GEV_SELF_COPY:-}" ] &&
  ! cmp -s "$GEV_HOME/scripts/install-vps.sh" "$GEV_SELF_COPY"; then
  log "The deploy script changed in this push; re-running the new one"
  GEV_REEXEC=1 exec bash "$GEV_HOME/scripts/install-vps.sh" "$@"
fi

# ------------------------------------------------------------------ build ---
run_as_service() {
  su -s /bin/bash "$GEV_USER" -c "export PATH=$NODE_DIR:\$PATH; cd $GEV_HOME && $*"
}
# Reuse the installed tree when the lockfile has not changed. `npm ci` deletes
# and re-downloads every dependency (about 380 MB) on each deploy; only a
# changed lockfile or a missing tree needs that again. The hash file is
# untracked, so `git reset --hard` leaves it in place.
DEPS_HASH_FILE="$GEV_HOME/.deps-lock-hash"
# Hash the dependency tree, not the app version: `npm version` rewrites the
# lockfile's own `version` fields on every bump, which would otherwise make
# every deploy look like a dependency change.
if command -v jq >/dev/null 2>&1; then
  LOCK_HASH="$(jq -S 'del(.version, .packages[""].version)' "$GEV_HOME/package-lock.json" | sha256sum | cut -d' ' -f1)"
else
  LOCK_HASH="$(sha256sum "$GEV_HOME/package-lock.json" | cut -d' ' -f1)"
fi
if [ -d "$GEV_HOME/node_modules" ] && [ -f "$DEPS_HASH_FILE" ] &&
  [ "$(cat "$DEPS_HASH_FILE")" = "$LOCK_HASH" ]; then
  log "Dependencies unchanged; reusing node_modules"
else
  # npm ci honours the lockfile; the registry fallback keeps a slow or blocked
  # npmjs reachable on hosts in mainland China.
  log "Dependencies"
  run_as_service "$NODE_DIR/npm ci --no-audit --no-fund" ||
    run_as_service "$NODE_DIR/npm ci --no-audit --no-fund --registry=https://registry.npmmirror.com" || {
      # `npm ci` deletes node_modules first, and both slots have files open under
      # it, so the rmdir fails with ENOTEMPTY. Only stopping every slot frees the
      # tree — and since that is the one moment there is no upstream at all, the
      # retry has to finish and come back down before anything else runs.
      log "npm ci failed; stopping every slot and retrying with a clean tree"
      systemctl stop 'gev@*.service' 2>/dev/null || true
      rm -rf "$GEV_HOME/node_modules"
      run_as_service "$NODE_DIR/npm ci --no-audit --no-fund --registry=https://registry.npmmirror.com" || {
        # Restore whatever slot was serving so the site is not left dark.
        systemctl start "gev@${GEV_LIVE_PORT:-$GEV_PORT}.service" 2>/dev/null || true
        die "dependency install failed; the previous slots were restarted"
      }
    }
  printf '%s\n' "$LOCK_HASH" >"$DEPS_HASH_FILE"
  chown "$GEV_USER:$GEV_USER" "$DEPS_HASH_FILE" 2>/dev/null || true
fi

# ------------------------------------------------------- memory headroom ---
# A build beside two resident slots exceeds a small host's RAM and thrashes
# swap (an 8-12 minute build). Only the serving slot runs between deploys, so
# this now clears a leftover standby from a host that still had one: the
# serving slot keeps answering and the switch below starts the idle one with
# the new release. Read `.slot` early so the idle slot is the right one.
SLOT_FILE="$GEV_HOME/.slot"
LIVE_PORT="$GEV_PORT"
if [ -f "$SLOT_FILE" ]; then
  . "$SLOT_FILE"
  LIVE_PORT="${GEV_LIVE_PORT:-$GEV_PORT}"
fi
if [ "$LIVE_PORT" = "$GEV_PORT" ]; then IDLE_PORT="$GEV_PORT_B"; else IDLE_PORT="$GEV_PORT"; fi
if [ "$IDLE_PORT" != "$LIVE_PORT" ] &&
  systemctl is-active --quiet "gev@$LIVE_PORT.service" 2>/dev/null; then
  log "Clearing the idle slot gev@$IDLE_PORT for the build"
  systemctl stop "gev@$IDLE_PORT.service" 2>/dev/null || true
fi

log "Build"
if [ -n "$CESIUM_ION_TOKEN" ]; then
  log "Cesium ion token: configured ($(printf '%s' "$CESIUM_ION_TOKEN" | cut -c1-12)…)"
else
  log "Cesium ion token: absent — the build uses Cesium's keyless terrain"
fi
if [ -n "$GOOGLE_MAPS_API_KEY" ]; then
  log "Google Maps key: configured ($(printf '%s' "$GOOGLE_MAPS_API_KEY" | cut -c1-12)…)"
else
  log "Google Maps key: absent — Google 3D loads through Cesium ion"
fi
run_as_service "$NODE_DIR/npm run build -- --outDir '$GEV_RELEASES/incoming' --emptyOutDir"

# ------------------------------------------------------- atomic switch ---
# A build writes into its own directory; `dist` is never touched while the
# service is serving. Publishing is one rename of a symlink followed by a
# restart that finds an already-complete tree, so the outage is the restart
# itself (a few hundred milliseconds) rather than the minutes a rebuild takes.
RELEASE_ID="$(git -C "$GEV_HOME" rev-parse --short HEAD)-$(date +%s)"
RELEASE_DIR="$GEV_RELEASES/$RELEASE_ID"
log "Publishing release $RELEASE_ID"
mkdir -p "$GEV_RELEASES"
rm -rf "$RELEASE_DIR"
mv "$GEV_RELEASES/incoming" "$RELEASE_DIR"
chown -R "$GEV_USER:$GEV_USER" "$GEV_RELEASES"
[ -f "$RELEASE_DIR/index.html" ] || die "the build produced no index.html; keeping the running release"

# The served root is the symlink, so swapping it is atomic on the filesystem:
# a reader sees the old tree or the new one, never a mixture.
PREVIOUS_RELEASE=""
if [ -L "$GEV_CURRENT" ]; then
  PREVIOUS_RELEASE="$(readlink -f "$GEV_CURRENT" || true)"
fi
# First run on a host that predates releases: the tree it is serving from
# `dist/` is the only copy of a working build, so keep it as a rollback target
# before the symlink takes over.
if [ -z "$PREVIOUS_RELEASE" ] && [ -f "$GEV_HOME/dist/index.html" ]; then
  LEGACY_DIR="$GEV_RELEASES/legacy-$(date +%s)"
  mkdir -p "$GEV_RELEASES"
  cp -a "$GEV_HOME/dist" "$LEGACY_DIR"
  chown -R "$GEV_USER:$GEV_USER" "$LEGACY_DIR"
  PREVIOUS_RELEASE="$LEGACY_DIR"
  log "Kept the existing dist/ as a rollback target"
fi
ln -sfn "$RELEASE_DIR" "$GEV_CURRENT.new"
mv -Tf "$GEV_CURRENT.new" "$GEV_CURRENT"

# ---------------------------------------------------------------- systemd ---
log "systemd units gev@.service (slots $GEV_PORT / $GEV_PORT_B)"
# One templated unit, two instances. Each instance serves whatever release the
# `current` symlink points at when it starts, on the port named by its instance
# id, so a deploy brings the new build up beside the old one.
cat >/etc/systemd/system/gev@.service <<UNIT
[Unit]
Description=God\'s Eye View (slot %i)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$GEV_USER
WorkingDirectory=$GEV_HOME
Environment=PATH=$NODE_DIR:/usr/local/bin:/usr/bin:/bin
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
# %i is the port, so both slots share one unit file.
Environment=PORT=%i
# Serve the published release through the symlink, so a deploy swaps the tree
# under a freshly started process instead of rewriting the one being served.
Environment=GEV_DIST_DIR=$GEV_CURRENT
# The app answers only Host headers it knows. Caddy passes the public name
# through, so it has to be listed here or every request gets a 403.
Environment=GEV_ALLOWED_HOSTS=$GEV_DOMAIN
# The app is reachable only through Caddy, so its forwarding headers are the
# honest record of how a request arrived. Without this the same-site gate sees
# a plain-HTTP hop and refuses every https:// Origin.
Environment=GEV_TRUSTED_PROXY=1
# Runtime credentials (the Google tile relay reads its key from here). The
# leading dash keeps the unit valid before the file exists.
EnvironmentFile=-$GEV_ENV_FILE
# `vite preview` serves dist/ as static files and never runs the provider
# plugins, so every /api route answered 404 on the deployed host. This entry
# point serves the same build and mounts those routes.
ExecStart=$NODE_BIN $GEV_HOME/server/standalone/serve.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "gev@$GEV_PORT.service" >/dev/null
systemctl enable "gev@$GEV_PORT_B.service" >/dev/null
# The single-instance unit from an older installer is NOT stopped here: it is
# the only thing answering until a slot is up, and stopping it now is exactly
# the outage this release removes. It is retired below, after the switch.
LEGACY_UNIT=0
if systemctl is-active --quiet gev.service 2>/dev/null; then
  LEGACY_UNIT=1
fi

# Start the new release on the slot that is NOT serving, and keep the old one
# answering until the new one has proved it works. `.slot` records which slot
# serves and which release it holds, so a rerun resumes instead of guessing.
SLOT_FILE="$GEV_HOME/.slot"
LIVE_PORT="$GEV_PORT"
if [ -f "$SLOT_FILE" ]; then
  . "$SLOT_FILE"
  LIVE_PORT="${GEV_LIVE_PORT:-$GEV_PORT}"
fi

if [ "$LIVE_PORT" = "$GEV_PORT" ]; then IDLE_PORT="$GEV_PORT_B"; else IDLE_PORT="$GEV_PORT"; fi

# Whether a release is already answering decides the order below: a redeploy
# keeps Caddy on the live slot until the new one passes its health probe, while
# a first install has nothing to protect and points Caddy at the slot that is
# about to start.
live_serving=0
if [ "$LIVE_PORT" != "$IDLE_PORT" ] &&
  systemctl is-active --quiet "gev@$LIVE_PORT.service" 2>/dev/null; then
  live_serving=1
else
  install_caddy_site "$IDLE_PORT"
fi

log "Bringing the new release up on the idle slot ($IDLE_PORT)"
# The idle slot was stopped for the build; restart it now with the new release
# while the live slot still serves, so traffic never moves to a cold slot.
systemctl restart "gev@$IDLE_PORT.service"
idle_healthy=""
for _ in $(seq 1 40); do
  if curl -fsS --max-time 3 "http://127.0.0.1:$IDLE_PORT/" >/dev/null 2>&1; then
    idle_healthy=1
    break
  fi
  sleep 1
done

if [ -z "$idle_healthy" ]; then
  log "The new release did not answer on $IDLE_PORT; leaving the live slot alone"
  systemctl stop "gev@$IDLE_PORT.service" 2>/dev/null || true
  die "release $RELEASE_ID failed its health check; the previous release is still serving"
fi

log "Switching traffic to $IDLE_PORT"
cat >"$SLOT_FILE" <<SLOT
# Written by scripts/install-vps.sh. Which slot serves, and what it holds, so a
# rerun resumes from the right one instead of guessing.
GEV_LIVE_PORT=$IDLE_PORT
GEV_RELEASE_ID=$RELEASE_ID
GEV_RELEASE_DIR=$RELEASE_DIR
SLOT
chown "$GEV_USER:$GEV_USER" "$SLOT_FILE" 2>/dev/null || true

# The new release answered, so point the single upstream at it. The probe above
# ran against the port directly, which is exactly what Caddy will now use.
install_caddy_site "$IDLE_PORT"

# Retire the old slot once in-flight requests on the reloaded upstream have
# drained. Only the serving slot is enabled, so a reboot does not bring back the
# second process this deploy just stopped.
sleep 2
if [ "$live_serving" = "1" ] && [ "$LIVE_PORT" != "$IDLE_PORT" ]; then
  systemctl stop "gev@$LIVE_PORT.service" 2>/dev/null || true
  log "Stopped slot $LIVE_PORT; $IDLE_PORT is the only serving slot"
fi
systemctl enable "gev@$IDLE_PORT.service" >/dev/null
if [ "$LIVE_PORT" != "$IDLE_PORT" ]; then
  systemctl disable "gev@$LIVE_PORT.service" >/dev/null 2>&1 || true
fi
if [ "$LEGACY_UNIT" = "1" ]; then
  # Only now, with a checked slot serving, is the old single instance safe to
  # remove from the rotation.
  systemctl disable --now gev.service >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/gev.service
  systemctl daemon-reload
  log "Retired the pre-slot gev.service"
fi

log "Slot $IDLE_PORT is serving release $RELEASE_ID"

# Keep the running release plus the two before it; older trees only cost disk.
if [ -d "$GEV_RELEASES" ]; then
  find "$GEV_RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' |
    sort -rn | tail -n +4 | cut -d' ' -f2- | xargs -r rm -rf
fi

# -------------------------------------------------------------------- webhook ---
log "Webhook service gev-webhook.service on 127.0.0.1:$GEV_WEBHOOK_PORT"
if [ ! -f "$GEV_ENV_FILE" ]; then
  # A service that can run a shell command must not start without a secret:
  # the webhook answers 503 until this file holds a value.
  umask 077
  cat >"$GEV_ENV_FILE" <<ENV
# God's Eye View server configuration. Mode 600: this file holds secrets.
#
# GitHub webhook: set the same value as the webhook's Secret field, then
#   systemctl restart gev-webhook
GEV_WEBHOOK_SECRET=
GEV_BRANCH=$GEV_BRANCH
GEV_INSTALLER=$GEV_HOME/scripts/install-vps.sh
#
# Cesium ion access token (from ion.cesium.com). Scripts/install-vps.sh reads
# it at build time, so editing it here and re-running the installer (or
# pushing to main) is enough. Keep it to one line, unquoted.
CESIUM_ION_TOKEN=
# Google Maps browser key (Google Cloud Console). Read at build time like the
# ion token. This key ships inside the browser bundle by design, so restrict it
# by HTTP referrer and to the Map Tiles API rather than treating it as secret.
GOOGLE_MAPS_API_KEY=
ENV
  chmod 600 "$GEV_ENV_FILE"
  log "created $GEV_ENV_FILE — add your GitHub webhook secret, then restart gev-webhook"
fi

# Keep the token key present in an env file written by an older installer, so
# the one place to set it is always obvious.
if ! grep -q '^GOOGLE_MAPS_API_KEY=' "$GEV_ENV_FILE"; then
  printf '\n# Google Maps browser key, read at build time.\nGOOGLE_MAPS_API_KEY=\n' \
    >>"$GEV_ENV_FILE"
  log "added GOOGLE_MAPS_API_KEY= to $GEV_ENV_FILE"
fi

cat >/etc/systemd/system/gev-webhook.service <<UNIT
[Unit]
Description=God's Eye View GitHub webhook
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$GEV_HOME
EnvironmentFile=-$GEV_ENV_FILE
Environment=PATH=$NODE_DIR:/usr/local/bin:/usr/bin:/bin
Environment=GEV_WEBHOOK_PORT=$GEV_WEBHOOK_PORT
Environment=GEV_WEBHOOK_PATH=$GEV_WEBHOOK_PATH
ExecStart=$NODE_BIN $GEV_HOME/server/webhook.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable gev-webhook.service >/dev/null
if [ "${GEV_WEBHOOK_MANAGED:-}" != "1" ]; then
  systemctl restart gev-webhook.service
fi
# A webhook-owned installer shares the receiver's systemd cgroup. Restarting
# it here would kill this installer and discard pushes queued during the
# build. The receiver checkpoints every accepted push and refreshes itself
# only after the installer and its follow-up deployments have completed.
sleep 1
systemctl is-active --quiet gev-webhook.service ||
  die "webhook did not start; check: journalctl -u gev-webhook -n 50"



log "Done"
printf '  App:      http://127.0.0.1:%s and :%s (gev@<port>.service)\n' "$GEV_PORT" "$GEV_PORT_B"
printf '  Public:   https://%s\n' "$GEV_DOMAIN"
printf '  Logs:     journalctl -u gev@%s -f\n' "$GEV_PORT"

printf '  Update:   sudo bash %s/scripts/install-vps.sh\n' "$GEV_HOME"
