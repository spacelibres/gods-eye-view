# Global target icon sparsification and modest elevation

Implement the user's approved final direction: thin dense target icons before applying limited vertical display height. Avoid fan-out and radial bundles of leaders.

- One shared collision domain for native billboard and point targets across layers, including entity visualizers. World positions, source show/cluster flags and pick IDs remain authoritative.
- Greedy screen-space Poisson thinning with a 56px minimum anchor separation. Selected targets rank first. Zooming separates anchors and reveals more source records.
- Surviving symbols use a modest 24px vertical lift, with bounded 44/64px alternatives for cards and collisions. No lateral fan-out. Short vertical leaders use a single 0.6px stroke at 35% opacity with no black outline or endpoint circles. Out-of-bounds candidates are rejected rather than shifted sideways.
- Shared label/card rectangles reserve space. Points preserve size, source colors, outline color/width and evaluated distance alpha. Suppression uses an owned zero-fade scalar independent of pixel-offset scaling, restored on visibility and cleanup.
- Verify dense thinning, selected priority, zoom reveal, bounded vertical offsets, cross-layer picking, source clustering transitions, original styles, resize, animation ordering and destroyed-source cleanup. Run shared overlay/airport tests, focused real WebGL QA, complete airport page regression and build/boundary/format checks, then bump patch, commit, push and verify VPS deployment.
