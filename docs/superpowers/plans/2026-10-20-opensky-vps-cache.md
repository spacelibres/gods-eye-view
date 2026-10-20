# OpenSky VPS cache implementation plan

Goal: every browser shares one VPS-owned worldwide snapshot acquired every120s.
Architecture: independent durable4000-credit state/track ledgers, OAuth helper,
background collector/cache-only endpoint, and shared frontend deadline cache.
Tech: Node24, vanillaJS, Vite provider lifecycle, atomic filesystem snapshots.

- [x] Write failing weighted-ledger tests; implement opensky-quota.js with
  createOpenSkyQuota({bucket,directory,now,fetchImpl,intervalMs}), waitMs(),
  fetch(url,options). Each data attempt costs4; buckets states/tracks independent.
  Persist locks, in-flight and actual remaining credits; honor complete retries.
- [x] Extract OAuth helper to opensky-auth.js, reexport its existing public API.
  Write collector/cache-only tests before replacing opensky.js demand fetching.
  Latest body, source epoch and metadata live outside checkout; no browser fallback
  can trigger ADS-B. Preserve fallback anchor export for existing GNSS callers.
- [x] Delegate frontend caching in standalone.js and source tests; coalesce by
  transport/clock, honor X-Feed-Next-Refresh-Ms, preserve source timestamps/age,
  cancellation and regional query compatibility. Default deadline120seconds.
- [x] Delegate tracks.js: per-aircraft shared/persistent bounded cache, in-flight
  coalescing and independent sharedOpenSkyTracksQuota. Military trace unchanged.
- [x] Replace obsolete demand-fetch tests with integration tests; update manifests,
  runtime docs and .env.example. Run focused tests, build, format, i18n, boundaries,
  full suite and applicable tracking gate. Independent review and fix findings.
- [ ] Bump patch after verification, commit/push and deploy authorized VPS.
  Set GEV_OPENSKY_STATE_DIR=/var/lib/gods-eye-view/opensky, preserve all credentials
  and ADS-B state. Verify live OAuth, source epoch, unchanged attempt ledger on
  repeated public reads, and automatic collection without browser demand.

No unbounded history archive, no promise that caching removes vendor limits.
Prior full-suite baseline has6 known unrelated failures and track gate104pass5fail.
All new tests use fixture transports and isolated temporary state; no live secrets.


Validation: focused integration 172/172; final aircraft providers 40/40; isolated
concurrency rechecks 17/17; allocation checks 15/15. Build, formatting, i18n and
package boundaries pass. Full unit run 8027 pass / 11 fail / 10 skip; two failures
loaded pre-fix quota code and now pass, three concurrency failures pass isolated,
leaving the six known unrelated baseline assertions. Tracking gate 104 pass /
5 fail, matching its existing local credential/terrain/stale-label baseline.
VPS persistent directory and credentials verified before deployment.
