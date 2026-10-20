# VPS ADS-B cache implementation plan

Goal: make the authorized VPS own ADS-B collection and persistent shared limits.
Architecture: shared fixed-origin quota gate, background military collector,
cache-only HTTP route and deduplicated client reads. No vendor key or IP changes.

- [x] Add failing deterministic tests for rolling budget, reservation isolation,
  persistence, reset/Retry-After and crash-safe fail-closed behavior.
- [x] Implement server/providers/aircraft/adsb-quota.js; route all three existing
  api.adsb.lol callers through it. Reserve 360 military / 140 ancillary attempts
  in a rolling 24-hour budget, at most one request per second across consumers.
- [x] Add collector tests for no request-driven fetches, independent scheduled
  updates, empty startup, persistence, invalid payloads and proper shutdown.
- [x] Replace adsb-lol.js demand-fetching with scheduled shared collection and
  cache-only responses including age and next-read metadata.
- [x] Add frontend regression tests then share/deduplicate snapshot and identity
  reads in standalone.js, honor server next-refresh and retry deadlines, retain
  genuine observation times and bounded stale motion behavior.
- [x] Update existing provider integration tests to the new cache-only contract.
  Run focused tests, build, format, i18n and boundaries; obtain independent review.
- [ ] Update docs and patch version, commit and push. Deploy on the existing VPS
  with a protected persistent state directory; seed known exhausted quota hold.
  Verify public route, ledger stability across frontend reads and OpenSky health.

Testing uses isolated temp directories, injected time/transport/schedulers; no
unit test consumes real vendor quota. Never log secrets. Deployment changes only
the approved project service; preserve existing provider credentials and backups.


Verification: 121 focused tests pass, including isolated rechecks of two
concurrency-sensitive full-suite failures. Production build 0.2.53, format,
i18n and boundaries pass. The full npm test attempt reports 7,993 pass,
8 fail, 10 skip: six already documented baseline failures and two timing
failures that pass in the focused recheck. Independent review's quota and
multi-worker findings were reproduced, fixed, and verified. Tracking gate
re-run uses a dedicated server with HMR disabled after local server interruption.
