# OpenSky VPS cache operations

The VPS collects one worldwide `/api/states/all` snapshot every 120 seconds.
Browser `/api/flights` reads never start upstream collection. This shares calls
between users; it does not remove OpenSky limits or provide second-by-second data.
At four credits per worldwide request, the default schedule uses 2,880 of the
Standard account's 4,000 daily state credits. Tracks use their independent bucket.
See [OpenSky API credits](https://openskynetwork.github.io/opensky-api/rest.html#api-credits).

## Persistent storage

Configure `/etc/gods-eye-view.env` on the VPS:

```dotenv
GEV_OPENSKY_STATE_DIR=/var/lib/gods-eye-view/opensky
OPENSKY_AUTH_MODE=oauth
```

Keep existing server-only OAuth client credentials. The directory must belong to
the service account (`gev`, mode 700); files use mode 600. Preserve it across
deployment and restart, outside the Git checkout.

- `states-snapshot.json`: latest validated body, original source epoch,
  publication time and authentication provenance. No historical archive.
- `states-quota.json`, `tracks-quota.json`: independent rolling 24-hour weighted
  attempt ledgers, actual remaining credits and complete retry deadlines.
- `tracks-cache.json`: bounded per-aircraft results, errors and pending reservations.
- `.lock` and `.uncertain` files: transaction protection and conservative recovery
  markers. Never delete these or reset a ledger merely to bypass a cooldown.

Each attempted data request reserves four credits before sending, including
network failures. Actual low remaining credits stretch the state interval over
the remaining budget window. A 429 honors the entire upstream retry deadline;
missing deadlines conservatively pause for 24 hours. Explicit anonymous mode has
the smaller 400-credit daily allowance. Authentication never silently downgrades.

## Serving and recovery

Responses expose `X-Feed-Age-Ms`, `X-Feed-Next-Refresh-Ms`, cache status and original
OpenSky epoch. A failed refresh preserves the last good snapshot, marks it stale,
and never changes its source timestamp. Data older than 24 hours is unavailable.
Browser instances coalesce reads and honor the shared refresh/cooldown deadline.
Track misses reserve a short durable per-aircraft pending entry before fetching;
other processes read its retry deadline rather than duplicating the cloud call.

On an unresolved storage marker, inspect service logs and directory ownership,
retain the files for diagnosis, and establish whether an upstream attempt occurred
before manual recovery. Allow any possible 24-hour credit window to expire before
removing uncertain accounting. Do not expose credential files or ledger storage
through the public web server. ADS-B storage and its separate allowance remain in
`GEV_ADSB_STATE_DIR`.

After deployment, compare state ledger attempt counts before and after repeated
public reads: they must remain unchanged within a collection interval. Observe a
later scheduled attempt without browser demand to confirm the background timer.
