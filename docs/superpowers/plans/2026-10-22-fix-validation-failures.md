# Resolve all recorded validation failures

User authorization: fix every recorded failed item, verify the results, then commit and push to GitHub. Work remains on `codex/airport-localization`; do not deploy or alter the production release as part of this request.

## Scope

- [x] Reproduce and resolve cockpit markup, first-run, credit attribution and voice-schema contract failures. Preserve intended current interface and full tool contracts; do not replace snapshots without explaining the differences.
- [x] Resolve Windows Caddy fixture portability and isolate terrain tests from persistent application cache without deleting it or weakening quota assertions.
- [x] Resolve incomplete frame-sampling windows and the tracked-ground-contact display-floor failure. Preserve all tracking assertions and diagnose render scheduling versus implementation errors.
- [x] Run all unit tests, including the serialized allocation probes, production build, formatting, boundaries and complete tracking browser regression. Run additional affected feature gates as indicated by the fixes.
- [x] Obtain independent review and fix actionable findings.
- [ ] Apply one verified package patch increment, commit and push changes, update PR #2 with current evidence, and confirm the local and GitHub commits match.

## Constraints

No fixture/hash-only changes without inspecting the actual contract. No skipped failures, arbitrary timeout extensions or reduced sampling requirements. Airport translation coverage is a separate unfinished task and must not be presented as completed by this validation repair.

## Repair evidence

- Restored provider attribution and mobile rail clearance. Updated stale logo/first-run selectors. Voice regression proves the exact airport additions recover the entire previous schema when removed; all three airport tool slots remain covered.
- Caddy tests use native Windows paths, and the writer preserves unrelated CRLF/trailing whitespace. Terrain routes use isolated temporary caches and retain a strict successful neighbor request assertion.
- Tracking samples count actual postRender events while an independent RAF pump requests rendering; the taxiing fixture reseeds its current display cell instead of comparing against a grid it has left. Complete browser gate: 109 passed, zero failures/skips; 60/60, 30/30 and 30/30 sampling windows completed. The pump is scheduling hardening; the exact original starvation mechanism remains unproven.
- Previously unreachable serialized allocation tests exposed placement-pool indexing, compaction and numeric boxing regressions. All 14 original workloads pass unchanged budgets; 74 overlay correctness tests pass and randomized geometry comparisons match the previous output.
- Parallel load exposed fixed-sleep races in AIS/CCTV tests. Lifecycle events replace sleeps; the one-second AIS release contract and cancellation before the real CCTV upstream deadline remain asserted. Controlled delays reproduce the old failures and pass with the repair; 24 focused tests pass.
- Independent review found no remaining actionable issues in the repairs or deterministic attribution harness. Final full-suite/browser results are recorded after their completion below.

## Final verification

- `npm test`: exit 0; ordinary tests 8,671 passed, 11 existing platform skips, zero failures; serialized focus allocation 1/1 and overlay allocations 14/14 passed. Total: 8,686 passed, zero failures.
- `node scripts/track-regression.mjs --url 'http://127.0.0.1:4198/?welcome=0&lang=en' --offline-imagery`: 109 passed, zero failures/skips.
- `node scripts/qa-attribution-b12.mjs --url 'http://127.0.0.1:4198/?welcome=0&lang=en' --offline-imagery --offline-providers`: 26 passed, zero failures. Screenshots inspected at 390x844 and 390x1600; visible credit clearance 19.5px. This fixture validates fallback imagery, not Google 3D service availability.
- `npm run format:check`: all 1,532 adopted source files passed. `npm run check:boundaries` and `git diff --check` passed.
- `npm run build` passed again with the final 0.2.78 package metadata. The existing large-chunk advisory remains a non-failing build warning.
- Feature-branch package patch: 0.2.78. Production stays at 0.2.76; no tag movement or deployment.
