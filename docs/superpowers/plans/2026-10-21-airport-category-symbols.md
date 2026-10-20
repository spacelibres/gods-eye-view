# Airport category symbols implementation plan

> REQUIRED SUB-SKILL: subagent-driven-development; execute approved user categories in this session.

**Goal:** Clearly distinguish physical airport types and supported civil/military/joint use.
**Architecture:** Portable provenance-backed usage resolver + shared cached SVG symbol module, integrated into current Airport layer/details/legend.
**Tech stack:** Node 24, Cesium, existing i18n and layer controls.

- [x] Usage worker: research and import structured usage evidence into src/sources/airports/usage-data.json with provenance; portable usage.js resolver+tests; no name/coordinate guessing or absent-schedule military inference; source civil service only confirms that fact. Provide resolveAirportUsage(record) -> {kind:civil|military|joint|unknown,sourceUrl,source,checkedAt,evidence}. Stable identity match.
- [x] Root: TDD src/layers/airports/symbols.js + symbol tests, heliport and other physical types take precedence; military/joint badges; add metadata/detail rows and layer legend. Preserve cached theme tint and picking.
- [x] Legend worker: minimal reusable layerPanel support for trusted per-legend icon images with accessible labels and existing color legends unaffected; targeted regression tests.
- [x] Root: independent review, locale/manifests/docs/QA, appropriate tests and production checks.
- [ ] Root: patch bump, commit/push main, deploy authorized VPS and verify version/data and actual map symbols.

## Verification evidence

- Independent review found LFSL historical ICAO reassignment and KMHT same-site former airbase. Both corrected with structured temporal audit, exact Wikipedia article and geographic identity, plus a persistent official-history exclusion. Final review approved; ten usage/importer tests passed. Unknown remains the fallback for missing or conflicting identity.
- 577 matched entities audited, 51 obsolete statements excluded; 500 article links retrieved before upstream429, then acquisition stopped and remaining missing identities fail closed. Current supplemental matches:245military45joint4293civilservice; this is incomplete community evidence, not a global operational registry.
- Release suite:90tests passed with zero failures. Postvisual outlined rotor/wave/basket regression:4symbol tests passed.
- Actual browser gate passed distinct category images, actual-symbol legend, real-location military/joint rendering and picking, details, themes, mobile, airport search/ambiguity, share restoration and cleanup. Small symbols inspected at20/28/80pixels.
- Production build0.2.58passed;1496sourcefiles format checked; six locales complete2687messages; package/import boundaries and all32published share tokens preserved.
