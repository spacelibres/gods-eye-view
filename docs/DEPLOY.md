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

Deployments never overlap: a push during a build queues one follow-up, so a
burst of commits costs two builds at most.

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
