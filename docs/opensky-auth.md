# OpenSky Auth Setup

God's Eye View uses explicit auth modes for `/api/flights`:

- `OPENSKY_AUTH_MODE=oauth` (default, recommended)
- `OPENSKY_AUTH_MODE=auto` (OAuth, retained as a compatibility alias)
- `OPENSKY_AUTH_MODE=anon`

Reference: OpenSky REST API docs recommend OAuth2 Client Credentials flow.

## Quick Start (OAuth Client JSON)

Import credentials from JSON (`clientId`/`clientSecret` or `client_id`/`client_secret`) into Keychain:

```bash
./scripts/opensky-import-client.sh ~/Downloads/credentials.json
# or: npm run opensky:import -- ~/Downloads/credentials.json
```

Then launch:

```bash
./scripts/dev-fresh.sh
```

Expected startup lines:

- `OpenSky auth mode: oauth`
- `OpenSky OAuth: configured`

## Optional: Launch With File (No Keychain Import)

```bash
OPENSKY_CREDENTIALS_FILE=~/Downloads/credentials.json ./scripts/dev-fresh.sh
```

Launchers resolve OAuth creds in this order:

1. `OPENSKY_CLIENT_ID` + `OPENSKY_CLIENT_SECRET`
2. `OPENSKY_CREDENTIALS_FILE`
3. Keychain (`opensky-network` / `client_id`, `client_secret`)

## VPS shared cache

The collector uses OAuth client credentials. Legacy Basic authentication is no
longer used by the aircraft provider; migrate existing Basic configurations to
OAuth. Authentication never silently falls back to anonymous access. Explicit
anonymous mode has a smaller daily credit allowance and a longer safe interval.
See [cache operations](OPENSKY-CACHE-OPERATIONS.md) for persistent VPS storage.

## Troubleshooting

Inspect proxy headers:

```bash
curl -si http://localhost:4173/api/flights | grep -iE 'HTTP/|X-OpenSky-Auth'
```

Useful reasons:

- `oauth_invalid_or_missing`: OAuth client not found/usable
- `oauth_invalid_credentials`: OAuth client rejected by OpenSky
- `rate_limited`: OpenSky throttling
