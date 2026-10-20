# Global Airports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement the tasks and review each deliverable.

**Goal:** A project-hosted global airport directory, visible map layer and airport name/ICAO/IATA search navigation.

**Architecture:** A bounded daily server collector publishes a persistent validated JSON snapshot with an initial bundled fallback. Same-origin viewport/search/detail routes read memory indexes; browsers never fetch OurAirports. A source adapter feeds a bounded Cesium point layer and airport geocoder.

**Tech Stack:** Node 24, JavaScript ES modules, Vite provider lifecycle, Cesium, existing world overlays and i18n.

## Global Constraints

- Approved scope: map layer, name/ICAO/IATA search and airport details; no runway/frequency feature.
- Persistent airport directory: `GEV_AIRPORTS_STATE_DIR=/var/lib/gods-eye-view/airports` outside checkout, `gev` ownership.
- Only OurAirports official data, public-domain provenance, original source revision and retrieval time.
- Stable numeric OurAirports ID represented as string; `ident` is not an ICAO code.
- Explicit finite coordinate validation; blank coordinates are not zero; country `NA` is Namibia.
- Elevation feet above MSL converts to metres above MSL; never treat it as ellipsoid height.
- Preserve last good data and daily check deadline across failure/restart; browser reads never refresh the upstream.
- Default map excludes closed facilities and uses zoom/type selection with bounded marker/label counts.
- Preserve ordinary place searches, ambiguous airport codes and caller cancellation.
- Existing spacelibre roles, actual SVG branding, shared overlay/selection and localization conventions.
- OpenSky and ADS-B collectors, limits and durable files remain independent.
- Verify, patch bump, commit/push and deploy to the previously authorized VPS; disclose known unrelated test failures.

## Shared interfaces

Airport records use this exact JSON-safe shape:

```js
({ id: '2434', ident: 'EGLL', name: 'London Heathrow Airport',
   type: 'large_airport', lat: 51.4706, lon: -0.461941,
   elevationM: 25.2984, countryCode: 'GB', country: 'United Kingdom',
   regionCode: 'GB-ENG', region: 'England', municipality: 'London',
   icaoCode: 'EGLL', iataCode: 'LHR', gpsCode: 'EGLL', localCode: '',
   scheduledService: true, keywords: '', website: '', wikipedia: '' });
```

Snapshot: `{ schemaVersion: 1, revision, updatedAt, source: 'OurAirports', sourceUrl, records }`.
List response: `{ revision, updatedAt, source, sourceUrl, total, matched, truncated, airports }`.
`total` is all directory records; `matched` is matches before cap; `truncated` states cap honestly.

Server routes (mount the specific routes before `/api/airports`):

- `GET /api/airports/search?q=EGLL&limit=8`: ranked exact codes, names, keywords; returns list response; do not silently overwrite duplicate codes.
- `GET /api/airports/detail?id=2434`: `{ revision, updatedAt, source, sourceUrl, airport }`, 404 for absent ID.
- `GET /api/airports?west=-180&south=-90&east=180&north=90&types=large_airport,medium_airport&limit=1200`: list response, inclusive antimeridian-aware bounds, bounded server maximum 2000. Omitted types exclude closed.

Frontend source factory `createAirportSource({ fetchImpl, baseUrl, now } = {})`:

```js
source.getSnapshot({ bounds, types, limit, signal }); // Promise<ListResponse>
source.search(query, { limit, signal });             // Promise<ListResponse>
source.getAirport(id, { signal });                   // Promise<DetailResponse>
```

Default baseUrl `/api/airports`. All methods validate response shape, coalesce/cache repeated requests and preserve independent consumer abort. An unavailable/corrupt response is never an authoritative empty directory.

## Task 1: Directory model, initial data and durable collector

**Owned files:** `server/providers/airports/{model,collector,index}.js`, their `.test.mjs` files, `src/sources/airports/records.js`, `scripts/import-airports.mjs`, `server/data/airports/{snapshot,provenance}.json`.

- [x] Write failing tests for CSV quoting/UTF-8, empty coordinates, Namibia, stable IDs, code identity, duplicate codes, invalid elevations, type filtering and antimeridian bounds.

```js
assert.equal(parseAirportCsv(csv, countries, regions)[0].countryCode, 'NA');
assert.equal(queryAirports(snapshot, { west:170,south:-90,east:-170,north:90 }).airports.length, 2);
```

- [x] Run `node --test server/providers/airports/*.test.mjs` and observe RED.
- [x] Implement bounded CSV import pinned to one upstream Git revision. Validate table headers, uniqueness and bounds; retain source metadata. Generate initial snapshot/provenance reproducibly, with a practical real-directory completeness check in import/refresh rather than arbitrary fixture-sized production acceptance.
- [x] Implement `airportsProxy(options)` plugin (`configureServer`, `configurePreviewServer`, `closeBundle`, `ready`) with read-only client routes, daily persisted refresh deadline, short durable cross-worker reservation, bounded requests, full Retry-After, atomic publication, last-good snapshot and bundled fallback. Inject clocks/fetch/timers/directory for isolated tests. Cancel errors without awaiting endless bodies. Never silently turn corrupt persistence into a fresh unlimited collector.
- [x] Run tests for cold/restart/failure/peer cache, query limits and HTTP error semantics; format owned files and self-review.

## Task 2: Browser source and airport search/navigation

**Owned files:** `src/sources/airports/{source,source.test}.js` (test uses `.test.mjs`), `src/search/{airports,airports.test}.js` (test uses `.test.mjs`), `src/search/defaults.js`, directly related search tests and any narrowly necessary ambiguity presentation.

- [x] Write RED source tests using fixture list/detail responses and two consumer aborts.
- [x] Implement shared interfaces above, bounded URL parameters, cache deadlines and capped response reads. Use `isAirportRecord` from `records.js` for reusable validation.
- [x] Write RED geocoder tests for `EGLL`, `LHR`, full airport name, ambiguity, failed airport route and an ordinary city query still reaching its normal provider.
- [x] Add a local airport provider to default composition without violating custom provider overrides. Uppercase codes or explicit airport phrases/name matches may use airport results; ordinary short city words must not be hijacked. Return a precise airport place with `types:['airport']` and `exact:true` only when identity is unambiguous. Ambiguous results must remain user-visible choices and never silently pick the first airport or fallback to a different airport.
- [x] Run source/search tests plus `src/search/placeSearch.test.mjs`, `src/locations.test.mjs`, `src/keylessGeocoder.test.mjs`; report legacy fixture adjustments and test evidence.

## Task 3: Bounded map layer, details and UI metadata

**Owned files:** `src/layers/airports/{index,model}.js`, their `.test.mjs`, `src/app/layers/airports.js`; targeted layer-specific UI config only after coordinating with root. Root owns catalog/source/state/i18n/shared manifests integration.

- [x] Write RED tests for world-scale large/medium selection, zoomed small/heliport inclusion, closed exclusion, point cap, labels, provenance/detail mapping and disable/destroy abort.
- [x] Implement `createAirportsLayer({source,overlayHost, ...services})` using the snapshot interface. Expose standard init/enable/disable/update/destroy, getStats, getAnalystRecords, row controls and safe entity selection. ID `airports`, name `Airports`, icon compatible with existing layer UI, default off.
- [x] Use camera moveEnd-triggered refresh plus standard layer update; coalesce/abort superseded view reads. Cap visible markers at 1200, shared overlay cards at a reasonable smaller cohort, and clear contexts/labels/listeners/timers on disable/destroy. Preserve last good display if refresh fails.
- [x] Point positions start from lon/lat and use established ground placement, never raw MSL elevation as ellipsoid Z. Read theme roles dynamically; no fixed replacement palette or logo.
- [x] Airport details show identity, codes, type, municipality/country, coordinates, optional MSL elevation and source revision/date. Use existing selection/overlay context rather than new unsafe HTML. Include explicit unavailable/unknown values.
- [x] Run layer tests, format owned files and self-review. Provide root any new user-facing i18n keys and integration requirements.

## Task 4: Composition, browser verification and delivery (root)

**Files:** sourceComposition/constructCatalog/standalone layerSources, layerState and permanent token ledger, layer UI grouping/icons/state as needed, provider registry, build manifests, DATA_SOURCES/dataCredits, `.env.example`, operations/CURRENT-STATE docs, locale catalogs, QA script, package metadata.

- [x] Register the new server provider through the existing provider registry (dev/preview/production share it). Add airport source contract and layer factory, default-off state, permanent next-free token and complete layer metadata. Adapt exact-count tests meaningfully.
- [x] Declare the new modules in package ownership and formatting manifests; keep browser/server boundaries intact. Add OurAirports attribution and data revision operations documentation.
- [x] Add browser QA fixture gate that verifies toggle, view zoom, details, airport-code/name fly-to, ordinary search, ambiguous results, source failure, disable cleanup, mobile controls, alternate themes and share-link restore. Fixture network stays same-origin and offline from live data APIs.
- [x] Run focused suites, `npm run build`, `npm run format:check`, `npm run check:boundaries`, `npm run i18n -- --check`, token checks, full unit suite and `npm run test:track` with resource-heavy runs serialized. Review the whole branch and fix important findings with regression tests.
- [ ] After verification increment patch from 0.2.54, commit and push `main` through fast-forward integration. Configure `GEV_AIRPORTS_STATE_DIR` outside VPS checkout preserving existing credentials and other provider files. Confirm automated deploy, live local-hosted airport/search/detail responses, pinned revision and unchanged acquisition count across repeated public reads.

All implementation tasks run in this session without another approval gate; the user has approved the recommended map-and-search scope.

## Verification evidence (2026-10-21)

- Final airport/backend/source/search/layer/voice/annotation/dev-preview suite: 73 tests, 72 passed, 1 POSIX permissions check skipped on Windows.
- Browser airport gate passed: default-off, scale filters, source failure, real marker click, details, theme without requests, mobile bounds, ICAO/IATA/name/city searches, ambiguity, share restoration and cleanup. Screenshots inspected.
- Production build passed for 0.2.55; formatting checked 1489 source files; six locales complete at 2664 messages; package/import boundaries and permanent layer token checks passed.
- Full unit run: 8105 tests, 8075 passed, 19 failed, 11 skipped before final fixes. Seven integration/fixture failures were corrected and rechecked; concurrency-sensitive transport/timing failures passed isolated rechecks. Existing cockpit markup, attribution, first-run and build-config expectation failures remain outside this feature.
- The general tracking gate is recorded separately; local voice provider probes return 503 without local credentials. Airport browser fixtures do not use live upstream APIs.
