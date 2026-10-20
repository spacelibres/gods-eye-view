# ADS-B cache operations

The project VPS collects military data once every four minutes. Browser requests
read the same snapshot and cannot trigger collection. The public adsb.lol API is
deprecated; this integration does not claim feeder re-api access or bypass vendor
limits. Source: https://www.adsb.lol/docs/open-data/api/.

## Storage and service

Set this in `/etc/gods-eye-view.env` on the authorized VPS:

```dotenv
GEV_ADSB_STATE_DIR=/var/lib/gods-eye-view/adsb
```

The directory must be writable only by the service account (`gev`, mode 700).
Files use mode 600. Keep it outside the Git checkout and preserve it on deployment:

- `quota.json`: rolling 24-hour request reservations, upstream remaining/reset,
  shared cooldown and an unresolved in-flight request when applicable.
- `military.json`: last validated source body, its source epoch and publication
  time; atomic replacement makes it available to all service workers.
- `quota.json.lock`: exclusive state transaction lock. A failed transaction
  intentionally leaves the lock rather than risking unrecorded requests.
- `quota.json.uncertain`: fail-closed marker when response headers could not be
  durably recorded. Automatic collection stays paused until operator recovery.

The observed vendor limits are 4/sec, 60/min and 500/day. This project uses the
stricter 1/sec and 500 per rolling 24 hours. Military attempts are four minutes
apart (at most 360/day); ancillary consumers are limited to 140/day. This protects
the project's requests; unrelated programs sharing the same public IP can still
consume vendor allowance. Respect a lower upstream remaining allowance too.

## Exhausted quota and unavailable snapshots

A usable reset or a longer Retry-After determines the pause. Without a usable
reset, an upstream 429 causes at least a 24-hour pause. At initial migration,
when the existing IP is known exhausted, seed `holdUntil` to now + 24 hours; do
not start an immediate probe to see whether it has recovered.

Cold/expired cache returns HTTP 503, `X-Feed-Cache: NONE`, `Retry-After`, and
`X-Feed-Next-Refresh-Ms`. This is explicit unavailability, not an empty successful
feed. A cached snapshot returns 200 with `HIT`/`STALE` and `X-Feed-Age-Ms`. Old
positions are dated and motion is bounded. A process that died before confirming
response headers leaves a pending reservation, conservatively paused for one
quota window. It exposes the full remaining pause after the transport deadline,
not a one-second browser retry loop.

## Recovery from uncertain persistence

Do not delete the ledger or lock to reset allowance. Stop every process sharing
the directory, preserve a protected copy, and check storage permissions/free
space. If a lock or uncertain marker remains, inspect the last request and vendor
deadlines. Repair a valid ledger with the maximum of all recorded holds, pending
request + 24 hours, and now + 24 hours when the outcome is unknown. Preserve
unexpired reservations. Only then remove the abandoned lock/marker and restart.
This manual path favors compliance over availability after storage corruption.

## Verification

Run the ADS-B quota/collector/HTTP tests and source contract tests with isolated
temporary state directories. These tests use fixture vendor replies. Forty
concurrent real HTTP reads must leave exactly one background upstream attempt.
`npm run test:track -- --url http://127.0.0.1:4197` covers the unchanged tracking
motion against explicit synthetic publication deadlines. On the VPS compare
`quota.json` reservations before and after repeated `/api/military` reads: reads
must not add attempts. Check `/api/flights` still reports `oauth_ok` and keep
OpenSky credentials out of Git and logs.
