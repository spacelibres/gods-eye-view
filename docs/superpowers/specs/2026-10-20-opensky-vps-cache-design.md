# OpenSky VPS shared latest snapshot

Status: proposed refresh policy for user review; no runtime code changed.

## Verified requirements and sources

The user wants the existing project VPS to continuously acquire the latest
OpenSky data once per collection round and share it with every browser. Browser
traffic must not multiply vendor calls. Preserve the current worldwide coverage.
Use the already configured OAuth client; no new credentials are needed.

Official REST reference, checked October 20, 2026:
https://openskynetwork.github.io/opensky-api/rest.html#api-credits

- Standard accounts have 4,000 daily credits per independent endpoint bucket.
  States, tracks and flights have separate buckets.
- Global /states/all costs 4 credits per request. A single bounding box of at
  most 25 square degrees costs 1 credit but does not provide worldwide coverage.
- Authenticated state timestamps have five-second resolution. That resolution
  is not a free subscription or a promise of five-second local acquisition.
- X-Rate-Limit-Remaining reports the remaining allowance.
  X-Rate-Limit-Retry-After-Seconds reports the wait after exhaustion.
- OAuth tokens last roughly 30 minutes and should be shared/refreshed centrally.

## Existing code findings

server/providers/aircraft/opensky.js currently uses browser-demand refresh,
a nine-second base cache and remaining-based adaptive TTL. Global snapshot
misses are not coalesced like the regional fallback. Retry logic can spend
credits twice, the cache and cooldown are in memory, and 429 retry deadlines
are capped at 30 minutes. These mechanisms do not guarantee a full day's budget
or survival across restarts. The browser flight source has no shared payload
cache comparable to the military source added in 0.2.53.

## Recommended policy

Keep worldwide coverage, with one VPS collector fetching a global snapshot
every 120 seconds: 720 planned requests / 2,880 state credits per 24 hours.
Reserve the other 1,120 state credits for accounted retries and headroom, and
reduce frequency or pause if upstream remaining requires it. Every network
attempt, including retry, reserves four credits before sending. Do not claim
that sharing cache removes vendor limits or turns two-minute observations into
second-by-second measurements.

All /api/flights browser requests read the latest shared VPS snapshot and
metadata; they cannot trigger collection, reset timers or fetch another region.
Concurrent/background workers share a single durable reservation. Persist the
latest validated body, original OpenSky source epoch, quota and cooldown under
/var/lib/gods-eye-view/opensky, outside the deployment checkout. Restore them
on restart. Do not archive every worldwide snapshot indefinitely.

Use server read deadlines to coalesce browser requests across map, tracking,
and query consumers. Retain source timestamps and age as cached reads recur;
existing bounded motion may estimate between observations but must not be
reported as a fresh upstream measurement. Unavailable data remains explicit.

Honor complete upstream retry/reset deadlines without shortening them; stop
sending when allowance is exhausted. An unknown exhaustion deadline uses a
conservative pause, not repeated probes. Reuse the existing OAuth single-flight
helper and refresh on expiry; bound and account for any authentication retry.

Track backfill keeps its separate endpoint bucket. Cache and coalesce requests
for the same aircraft on the server, preserve provenance, and account for its
own allowance; one global state snapshot does not contain every historical track.
Do not let browser-demand fallbacks bypass either OpenSky or existing ADS-B
quota ownership. The previously deployed ADS-B policy stays independently active.

## Alternatives and tradeoffs

- Worldwide every 120 seconds: recommended 2,880 credits/day, safe headroom.
- Worldwide every 90 seconds: 3,840/day, little room for failures or other usage.
- One small fixed region every 30 seconds: 2,880/day at 1 credit/request, faster
  but loses worldwide coverage. Multiple regions would multiply the cost.
- Worldwide every 30 seconds: 11,520/day, exceeds the current account allowance.

## Verification and delivery after policy approval

Write deterministic tests first: concurrent readers cause no upstream fetches;
only the scheduler acquires; weighted attempts and retries persist; restarts and
clock shifts cannot reset allowance; long retry headers are honored; peer workers
read the same source epoch; cache replay does not renew aircraft observations;
track requests share cache and their independent allowance. Run focused source,
provider and tracking tests, build, i18n, format, boundaries and independent review.
Bump patch, commit/push, deploy on the authorized VPS and verify the public feed,
cache/ledger stability across repeated reads and unchanged ADS-B collection.
