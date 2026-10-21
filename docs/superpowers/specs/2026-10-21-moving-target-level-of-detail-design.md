# Moving aircraft and satellite display levels

Status: approved by the user on 2026-10-21. Scope: live civil/military aircraft and satellites; retain existing airport and fixed-target presentation.

## Problem and evidence

The global marker layout hides native sprites independently of detection rendering. Detection receives geographic records and continues drawing brackets and labels for suppressed targets. Satellite point proxies introduce an additional visual anchor. The preceding aircraft anchor fix aligns displaced billboards but does not coordinate visibility or presentation detail.

## Recommended behavior

Retain every loaded record for propagation, search, selection and tracking. Change only viewport presentation. Objects beyond the horizon or outside the viewport remain culled normally. Camera zoom never triggers a new feed request.

- Overview: small colored points, approximately 2–3 CSS pixels; no ambient labels, brackets or leader lines. Coincident points may share pixels; do not displace them into a forest of leaders.
- Intermediate: small aircraft silhouettes / satellite marks, approximately 8–12 CSS pixels. Keep crowded contacts as points instead of deleting them. Show identity on selection; omit routine brackets.
- Detail: restore existing detailed symbols. Admit concise name labels only when screen space permits. A contact denied label space keeps its symbol or point. Selected/tracked contacts retain their highlight and current detail readout at every level. A near-view hover highlight may show a bracket; ordinary contacts do not all acquire selection boxes.

Use per-target camera distance together with local screen occupancy, rather than one globe camera-height threshold: satellites occupy very different orbital heights. Initial transition distances: aircraft 1,500 km / 150 km; satellites 30,000 km / 3,000 km. Crowding can reduce detail one level, but cannot remove the overview point. Apply 20 percent hysteresis around transitions and preserve stable identity to avoid flicker. Validate these initial distances in real globe, regional and close views before release.

## Options considered

1. Only hide orphaned labels: smallest defect fix, but still removes too many target symbols.
2. Coordinated points → small icons → detailed icons with independently admitted labels: recommended; retains situational coverage while reducing clutter.
3. Aggregate everything into numeric clusters: compact at global scale, but obscures individual moving targets and changes picking semantics.

## Implementation boundaries

A single frame presentation record owns rendered visibility, display level, visual anchor and permission for labels/brackets. Native symbols, point proxies and detection must consume the same record. Do not infer visibility merely from native show flags because collision currently uses a zero-alpha distance scalar and point proxies.

The global collision solver must not erase aircraft or satellite overview points when its detailed-candidate budget is exhausted. Apply collision budgets to detailed symbols and label admission. Never remove catalog records or change geographic positions. Retain original visual styles for restoration on zoom/layer toggles, native picking and model ownership. Model-rendered aircraft continue using their model anchor; satellite detection follows the visible point/proxy rather than a hidden original. Hidden/behind-Earth/disabled targets cannot emit independent labels, brackets or stale replayed callouts.

No new external service, new color system, changes to the spacelibre logo, or changes to airport/fixed-site icon design.

## Verification

Write failing regressions for orphaned aircraft and satellite labels, budget exhaustion retaining point coverage, point-to-icon-to-detail transitions, selected target priority, moving proxy alignment and restored original styles. Exercise real Cesium with dense civil aircraft, military aircraft and satellites, mixed layers, repeated zoom-in/out, camera movement, DPR 1 / 1.25 / 2 and laptop/mobile viewports. Confirm zero feed requests during pure zoom and unchanged search/selection identities. Verify selected/tracked highlights and model handoff, offscreen/disabled cleanup, no label replay after a target becomes ineligible. Compare screenshots at each level, then run relevant unit suites, build, formatting, version bump, GitHub push and VPS/public-version checks.


## User correction: preserve classic detection frames

On 2026-10-21 the user explicitly rejected removing the classic frames. Compact and detailed icons retain the existing four-corner detection brackets. Unselected overview dots and suppressed targets do not emit frames. Selection/tracking still preserves the classic highlight at every zoom; labels remain subject to detail level and space. This overrides the earlier selected-only bracket rule without changing the established frame artwork.
