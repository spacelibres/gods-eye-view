# Local airport translations implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Serve locally stored multilingual airport names consistently and maintain translations with field-level changes.

**Architecture:** Keep canonical OurAirports files unchanged. A versioned local translation catalog contains entity IDs and per-field source fingerprints. Server queries project translations onto canonical records, retaining original names as search aliases. Frontend requests carry locale and refresh visible text on locale changes.

**Tech Stack:** Node.js, vanilla JavaScript, Cesium, node:test, existing Vite provider middleware.

## Global Constraints

- Languages: en, es, ru, zh-CN, zh-TW, ja, ko.
- No paid translation APIs or runtime external translation requests.
- Preserve IDs, codes, coordinates, raw CSVs, existing HUD and visual design.
- Missing or stale translations fall back to originals and are reported as missing.
- Never report partial translation coverage as full completion.
- Existing feature branch codex/airport-localization is used in place.

## Verified implementation checkpoint

The local catalog, offline maintenance and locale integration are implemented.
Changed-test verification: 138 passed, one POSIX-only test skipped on Windows.
Independent final review additionally ran 62 passing tests and found no remaining
blocking issue. Airport browser and seven-language live-switch gates passed.
The package patch is 0.2.77 on this feature branch; no release tag or production
deployment is part of this checkpoint.

The first authored database contains 255 airport names in six target languages,
3,535 municipality fields and 38,646 region fields per language. **Worldwide
airport-name and navigation-name translation remains unfinished.** Missing
entries are visible in the offline report and persistent worklist, and fall back
to source text. This checkpoint is intended for a draft PR, not a claim that the
entire requested database has been translated.

The full parallel suite reported 8,649 passes, 13 failures and 11 skips. Twelve
failures match previously documented cockpit/attribution/first-run/schema and
Windows Caddy fixtures. The additional terrain quota assertion used a persistent
cache; all 10 terrain bounds tests passed with a fresh working directory.

Final formatting checked all 1,531 adopted files successfully. The complete
tracking gate with bundled imagery finished **104 passed, 5 failed, 0 skipped**:
four assertions depend on two incomplete frame windows (59/60 and 28/30), and one
tracked-contact display-floor regime assertion failed. These remain unresolved;
they are not represented as passing or proven baseline failures. Draft PR #2
remains unmerged and production remains unchanged.

### Task 1: Local catalog and incremental maintenance

**Files:** server/providers/airports/localization.js, server/providers/airports/localization.test.mjs, scripts/airport-translations.mjs, server/data/airports/translations/.

**Interfaces:** export fieldFingerprint(record, field), localizeSnapshot(snapshot, catalog, locale), translationWorklist(snapshot, catalog), mergeTranslations(snapshot, catalog, entries). Entries identify entity kind, ID, field, locale, source fingerprint and translated text. Locale databases store verified translations only.

- [ ] Write tests proving unchanged input and coordinate-only updates produce no new work, renamed fields invalidate only their own translations, stale imports fail atomically, duplicate imports are idempotent, and projected names preserve original search aliases.
- [ ] Run `node --test server/providers/airports/localization.test.mjs`; observe missing behavior failures.
- [ ] Implement pure catalog functions and an offline CLI with export/import/report commands; validate all entries before writing, atomically replace only changed language files, and retain manual translations.
- [ ] Re-run the focused tests and exercise CLI against the real bundled snapshot. Report actual valid/missing coverage.

### Task 2: Server and frontend locale integration

**Files:** server/providers/airports/index.js, src/sources/airports/source.js, src/search/airports.js, src/app/layers/airports.js, src/layers/airports/index.js, src/layers/airports/references.js and corresponding tests.

**Interfaces:** API accepts lang; source requests obtain locale through injected getLocale. Server uses localizeSnapshot before bounds/detail/search queries. Names index includes retained original name. A locale event refreshes labels, details and search without resetting camera or changing stable entity IDs.

- [ ] Add failing API/source/search tests for locale-scoped requests, localized detail and original/localized search, including no-space CJK names.
- [ ] Implement catalog loading and locale-scoped bounded requests; reject late old-locale results at presentation boundaries.
- [ ] Wire locale changes to existing airport text refresh while preserving selection, dismissed cards and camera; cover navigation references too.
- [ ] Run focused tests, build, airport browser gate and locale browser gate.

### Task 3: Translation content and release verification

**Files:** language catalogs, docs/AIRPORTS-OPERATIONS.md, package metadata, CHANGELOG.md, scripts/format-scope.json and boundary inventories where required.

- [ ] Author pretranslated names using established airport/city/region terminology. Validate identities against bundled records, retain provenance and distinguish translated coverage from source fallback.
- [ ] Run offline worklist/report checks, export/import round-trip and byte comparisons showing unmodified source files and unaffected language catalogs remain unchanged.
- [ ] Run formatting, boundaries, build and relevant tests; record pre-existing failures separately.
- [ ] Request independent spec and code review; resolve actionable findings.
- [ ] Increment package patch after verified implementation, commit changes, push authorized GitHub branch/integration and verify deployment where applicable. Do not claim full content coverage until the coverage report proves it.
