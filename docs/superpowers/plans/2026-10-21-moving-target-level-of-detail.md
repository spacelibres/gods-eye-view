# Moving Target Detail Implementation Plan

> **For agentic workers:** Execute this approved plan in this session, using test-first changes and a review before integration.

**Goal:** Keep all loaded aircraft and satellite targets represented while progressively revealing symbols and labels.

**Architecture:** A weakly keyed moving-target registry supplies shared per-frame presentation state. The existing marker layout owns compact proxy visuals; detection consumes their visibility, anchor and detail permissions. Static targets retain existing collision behavior.

**Tech Stack:** JavaScript, Cesium, Node test runner, Puppeteer.

## Global constraints

No data removal or feed requests on zoom. Preserve search, native picking, tracking, geographic coordinates and existing spacelibre visual identity. Distance bands: aircraft 1,500 / 150 km; satellites 30,000 / 3,000 km; 20 percent hysteresis. Selected targets remain detailed. Crowding reduces symbols to points instead of deleting them.

## Task 1: Shared presentation policy and moving visual integration

- [x] Write failing policy and marker-layout tests for all three levels, hysteresis, selected targets and dense candidate-budget overflow.
- [x] Implement `src/overlays/movingTargetPresentation.js` with weak registration and current presentation state.
- [x] Register native aircraft and satellite visuals in their snapshot/catalog/tracking owners.
- [x] Extend `src/overlays/markerLayout.js` to draw moving proxies independently of static collision budget, preserving original styles and geographic positions.
- [x] Verify zoom restoration, crowding, selection and teardown.

## Task 2: Detection alignment and eligibility

- [x] Write failing detection tests for remote/suppressed targets, stale callout replay and selected highlights.
- [x] Supply satellite point and military sprite references; use one presentation state for projection, label and bracket eligibility.
- [x] Preserve world anchors for 3D models and selected tracking entities.
- [x] Update package boundary ownership for the shared dependency.

## Task 3: Real-browser verification and release

- [x] Add a real Cesium regression covering mixed moving targets, repeated zoom, dense scenes, native picking and high-DPI laptop/mobile viewports; inspect screenshots.
- [x] Run relevant tests, format, boundary checks and production build.
- [x] Request independent code review; resolve blockers.
- [x] Increment patch version, document change, commit and push main plus immutable tag.
- [ ] Verify VPS and public version; report outcome and limitations.
