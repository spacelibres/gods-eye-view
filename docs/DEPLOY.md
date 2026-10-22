# Deploying to a VPS

The project runs as a Node app behind an existing Caddy, and updates itself
from GitHub.

## One command

On a host that already runs Caddy (this was verified on Ubuntu 26.04 with
Caddy 2.6.2):

```bash
curl -fsSL https://raw.githubusercontent.com/spacelibres/gods-eye-view/main/scripts/install-vps.sh \
  | sudo bash
```

Cloned already? `sudo bash scripts/install-vps.sh`.

The script is idempotent. Re-running it fetches `main`, rebuilds and restarts,
which is exactly what the webhook does on every push.

## What it creates

| Thing | Where |
| --- | --- |
| Node 24 | `/opt/node24` — the system Node.js is left untouched |
| Checkout | `/opt/gods-eye-view`, branch `main` |
| App service | `gev.service` on `127.0.0.1:4173` |
| Webhook service | `gev-webhook.service` on `127.0.0.1:4180` |
| Configuration | `/etc/gods-eye-view.env` (mode 600) |
| Caddy block | between the `gods-eye-view` markers in `/etc/caddy/Caddyfile` |

The Caddy step only rewrites the block between its own markers. Other sites in
the same file are preserved byte for byte, and `caddy validate` runs before
the reload — a bad block leaves the running configuration alone.

Overrides, all optional: `GEV_HOME`, `GEV_REPO`, `GEV_BRANCH`, `GEV_DOMAIN`,
`GEV_PORT`, `GEV_NODE`, `GEV_USER`, `GEV_WEBHOOK_PORT`, `GEV_WEBHOOK_PATH`.

## Build-time credentials

The installer reads `CESIUM_ION_TOKEN` and `GOOGLE_MAPS_API_KEY` from its own
environment, or — when either is unset — from `/etc/gods-eye-view.env`. The file
wins for automatic deploys: the webhook rebuilds with only that file loaded, so
a value exported by hand is gone on the next push.

```bash
sudoedit /etc/gods-eye-view.env     # CESIUM_ION_TOKEN=...
                                    # GOOGLE_MAPS_API_KEY=AIza...
sudo bash /opt/gods-eye-view/scripts/install-vps.sh
```

The build prints `Cesium ion token: configured (eyJhbGciOiJ…` and
`Google Maps key: configured (AIzaSyExample…` when it picks each one up, and
`absent` when it does not. The credentials decide which host serves the globe:

| Configured | Startup route | Requests go to |
| --- | --- | --- |
| `GOOGLE_MAPS_API_KEY` | `google-direct` | `tile.googleapis.com` |
| only `CESIUM_ION_TOKEN` | `google-ion` | `api.cesium.com`, Google's hosted asset |
| neither | keyless | Esri imagery on a plain globe |

Both values are baked into the browser bundle, so treat them as public. The
Google key is therefore protected by its HTTP-referrer restriction and by
limiting it to the Map Tiles and Maps JavaScript APIs, not by secrecy; the ion
token by its asset scope. Never commit either: the file above stays outside the
checkout at mode 600.

## The webhook

```bash
# 1. Pick a secret and record it
openssl rand -hex 32

# 2. Store the same value on the host
sudoedit /etc/gods-eye-view.env      # GEV_WEBHOOK_SECRET=...
sudo systemctl restart gev-webhook

# 3. Register it on GitHub
#    Repository → Settings → Webhooks → Add webhook
#      Payload URL   https://godseye.spacelibre.cn/webhook
#      Content type  application/json
#      Secret        the value from step 1
#      Events        Just the push event
```

Every push to `main` rebuilds and restarts the app. A push to any other branch,
a deletion, or a push to another repository is acknowledged and ignored.

Requests are accepted only with a valid `X-Hub-Signature-256` over the raw
body. With no secret configured the service refuses everything, because it can
run a shell command.

Deployments never overlap: pushes arriving during a build coalesce into one
follow-up for the latest accepted push. Further pushes during that follow-up
can queue another run.

Before returning `202 deploy queued`, the receiver writes and syncs a private
checkpoint outside the checkout at
`/var/lib/gods-eye-view-webhook/pending.json`. The directory is owned by the
service user (root for the installed unit), mode `700`, and the file is mode
`600`. `GEV_WEBHOOK_STATE_FILE` in `/etc/gods-eye-view.env` can override the
path; its parent must have the same private ownership and permissions. The
checkpoint contains deployment metadata, never the webhook secret or full
payload. Only requests that passed signature, event, branch and repository
checks can create it. Startup validates it against the configured branch and
repository before resuming work.

The checkpoint survives receiver termination. A successful matching deployment
consumes it; a newer accepted push keeps its own checkpoint until its build
finishes. Failed builds retain the checkpoint without an automatic retry loop.
After correcting the build failure, restart `gev-webhook` to retry, or send a
new push. Invalid or inaccessible state makes health report `ok: false` and
refuses deployment requests with `503`; inspect ownership, permissions and
the service journal before restarting. Do not delete pending state unless you
intend to discard accepted work.

Webhook-owned installers receive `GEV_WEBHOOK_MANAGED=1` and leave their own
systemd service running. Once all accepted work finishes, the receiver closes
its listener and exits successfully; systemd's `Restart=always` then loads the
updated receiver code. Manual installer runs still restart the webhook unit.
This avoids killing an active installer or losing a queued push when refreshing
the receiver. A checkpoint accepted during the close handoff is replayed by
the next receiver. Idle health after a refresh has `lastRun: null`; inspect the
journal for completed deployment history, and `pending` for outstanding work.

Health and the last run:

```bash
curl https://godseye.spacelibre.cn/webhook/health
journalctl -u gev-webhook -f
```

## Operating it

```bash
systemctl status gev gev-webhook
journalctl -u gev -f                  # app logs
journalctl -u gev-webhook -f          # build logs
sudo bash /opt/gods-eye-view/scripts/install-vps.sh   # deploy by hand
```

## Notes from the first deployment

These bit us and the script now handles them:

- **Node 24 must be readable by the service user.** nvm installs under `/root`,
  which is mode 700, so an unprivileged service cannot execute it. The script
  installs a tarball into `/opt/node24` and opens it read-only.
- **`GEV_ALLOWED_HOSTS` is required.** The preview server answers only Host
  headers it recognises; without the public name every request through Caddy
  is a 403.
- **Swap matters.** A 2 GB host running another Node app cannot build this
  project from RAM alone. The webhook build peaked at 1.3 GB, so the host this
  was installed on was raised to 4 GB of swap first.
webhook end-to-end test
