# Aviation map symbols implementation plan

> REQUIRED SUB-SKILL: subagent-driven-development; execute in this session with independent owners and review.

**Goal:** Aircraft airport symbols plus usable aviation navaids and country names.
**Architecture:** Extend the existing daily atomic directory; cache-only APIs feed bounded reference overlays alongside Airports.
**Tech stack:** Node 24, Cesium, existing source/overlay/i18n services.

- [ ] Root: test and replace airport dots with themed aircraft billboards; retain selected entities and browser picking.
- [ ] Backend/source worker: extend collector/model/records/source, importer and fixtures for same-revision navaids and countries. API contracts getNavaids({bounds,limit,signal}), getCountries({signal}); navaid response {metadata,total,matched,truncated,navaids}; countries response {metadata,countries}. Preserve daily budget, old snapshot fallback and strict complete production data checks.
- [ ] Reference-display worker: create portable aviation references helper with init/enable/update/disable/destroy and theme refresh. Uses optional source methods, navaid symbols/context/details and bounded country labels. Integrate only after root aircraft edits finish. Use current directory country names and bundled geography/localization.
- [ ] Root: registry/manifest/i18n/docs ownership, independent reviews, targeted and browser tests, build/format/boundaries/i18n/token gates.
- [ ] Root: patch bump, commit/push, deploy and verify public airport/navaid/country data and unchanged collection checkpoint under repeated reads.

No additional user approval gate: user specified aircraft symbols and confirmed aviation navigation stations.
