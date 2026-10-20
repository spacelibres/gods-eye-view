# ADS-B upstream quota and shared background snapshots

Status: approved by the user. Storage and collection must live on the project VPS.

The existing military endpoint fetches on browser demand with a 12-second
cache, while GNSS and the civilian fallback independently consume the same
adsb.lol IP allowance. The observed upstream headers advertise 4 requests per
second, 60 per minute and 500 per day; the remaining allowance is currently 0.
The public API is deprecated; this work uses its existing access without
claiming access to the feeder-only replacement or bypassing limits.

## Proposed behavior

- One server-owned background collector refreshes the military snapshot every
  four minutes (360 scheduled attempts per 24 hours), independently of browser
  requests. The HTTP route only reads its shared snapshot and status.
- All three adsb.lol consumers share a durable rolling request budget: at most
  one outgoing request per second and 500 attempts per rolling 24 hours, with
  military refresh capacity reserved. Every attempt, including failures, counts.
  Persist reservations and cooldown before sending, so service restarts do not
  reset the allowance. Use an exclusive lock for state updates across processes.
- Respect upstream remaining and reset headers and Retry-After. Never shorten
  an upstream deadline. On an exhausted quota or a 429 without a usable reset
  deadline, hold requests for 24 hours rather than probing every 30 seconds.
- Persist the last validated snapshot atomically. Distinguish last successful
  observation, cache age, next refresh and upstream failure. Do not present
  old positions as live. Expired data must not drive indefinite extrapolation.
- Frontend requests share one in-flight request and cached result, and schedule
  the next read from server refresh metadata. Turning a layer on, tracking and
  repeated clicks must not force extra upstream reads. No fast retry loop on
  unavailable data. Cancellation and layer disposal still release resources.
- Keep current attribution and public payload compatibility. Do not add keys,
  rotate IPs or automatically migrate to feeder-only APIs.

## Alternatives considered

1. Recommended: scheduled collector, persistent shared quota and frontend cache.
   Works with the existing VPS and has predictable cost and explicit age.
2. Only increase the military HTTP cache: smaller change, but browser demand,
   restarts and other consumers can still exhaust the allowance.
3. Migrate to feeder re-api: requires separately authorized feeder credentials
   and IP access, which are not currently available.

## Verification and delivery

Use fake time and upstream replies to verify concurrent clients, daily and
short-window budgets, restart persistence, long Retry-After, empty startup,
stale metadata and disposal. Verify frontend request deduplication and cadence,
then run focused provider/source/layer tests, build, i18n, format and boundaries.
Bump patch after verification, commit and push, deploy to the authorized VPS,
and verify the public route and unchanged OpenSky OAuth health. Current quota
exhaustion may prevent proving a fresh military snapshot immediately; report
that honestly while verifying no repeated upstream requests occur.
