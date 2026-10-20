# Aviation map symbols implementation plan

> REQUIRED SUB-SKILL: subagent-driven-development; execute in this session with independent owners and review.

**Goal:** Aircraft airport symbols plus usable aviation navaids and country names.
**Architecture:** Extend the existing daily atomic directory; cache-only APIs feed bounded reference overlays alongside Airports.
**Tech stack:** Node 24, Cesium, existing source/overlay/i18n services.

- [x] Root: test and replace airport dots with themed aircraft billboards; retain selected entities and browser picking.
- [x] Backend/source worker: extend collector/model/records/source, importer and fixtures for same-revision navaids and countries. API contracts getNavaids({bounds,limit,signal}), getCountries({signal}); navaid response {metadata,total,matched,truncated,navaids}; countries response {metadata,countries}. Preserve daily budget, old snapshot fallback and strict complete production data checks.
- [x] Reference-display worker: create portable aviation references helper with init/enable/update/disable/destroy and theme refresh. Uses optional source methods, navaid symbols/context/details and bounded country labels. Integrate only after root aircraft edits finish. Use current directory country names and bundled geography/localization.
- [x] Root: registry/manifest/i18n/docs ownership, independent reviews, targeted and browser tests, build/format/boundaries/i18n/token gates.
- [ ] Root: patch bump, commit/push, deploy and verify public airport/navaid/country data and unchanged collection checkpoint under repeated reads.

No additional user approval gate: user specified aircraft symbols and confirmed aviation navigation stations.

## Review and verification

- Independent airport symbol/readout review approved, 15/15 and 12/12 tests.
- Independent reference backend/source review approved, 29 passed and one Windows-only permissions skip. Same-revision migration retains the daily checkpoint.
- Independent reference display review found internal context ownership was missing. Fixed with explicit ownerLayerId and a real manager/context-store regression. Reviewer rechecked: 33/33 passed, no remaining P1/P2.
- Actual browser gate passed: aircraft billboard, navigation symbols, complete frequency/DME/country details, active parent-owned selection, card clear of bottom controls, country names, themes, mobile, source failure, name/ICAO/IATA/city search, ambiguity, share restore and cleanup. Screenshots inspected.
- Six locale catalogs complete at 2678 messages; package/import boundaries passed; permanent share tokens retain all 32 published mappings with no new token.

- Final release suite: 192 tests, 191 passed, one Windows-only permissions skip, zero failures. Production build 0.2.57 passed; formatting checked 1491 source files.
