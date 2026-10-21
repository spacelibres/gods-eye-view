import assert from 'node:assert/strict';
import test from 'node:test';
import { placementVariants } from './worldOverlayDraw.js';

/**
 * Labels and icons must not pile up on top of each other. Four compass
 * positions are not enough once several entries share one anchor: the fifth
 * has nowhere to go but into the pile, or out of sight entirely.
 *
 * Stacking fixes that by giving each entry a height. A label that cannot sit
 * beside its anchor steps further up (or down) instead of overlapping its
 * neighbour, and the leader drawn back to the anchor keeps the association
 * readable.
 */

const base = {
  width: 80,
  height: 16,
  viewportWidth: 1000,
  viewportHeight: 800,
};

test('the first placement is the plain adjacent one, unchanged', () => {
  const [first] = placementVariants({ ...base, anchorX: 500, anchorY: 400 });
  assert.equal(first.corner, 'above');
  assert.equal(first.rect.y, 400 - 12 - 16);
  // No stacking means no extra leader: the shipped single-step leader.
  assert.equal(first.leaderOffset, 0);
});

test('each stack step lifts the label one row clear of the one before it', () => {
  const steps = placementVariants({
    ...base,
    anchorX: 500,
    anchorY: 400,
    stackSteps: 3,
  });
  const above = steps.filter((p) => p.corner === 'above');
  assert.ok(above.length >= 3, 'three stacked rows have to be offered');
  const rows = above.slice(0, 3).map((p) => p.rect.y);
  // Each row sits exactly one row (height + gap) above the previous, so two
  // labels never share a pixel.
  assert.equal(rows[1], rows[0] - (16 + 12) - 0);
  assert.equal(rows[2], rows[1] - (16 + 12) - 0);
});

test('a stacked row reports a leader long enough to reach its anchor', () => {
  const steps = placementVariants({
    ...base,
    anchorX: 500,
    anchorY: 400,
    stackSteps: 3,
  });
  const above = steps.filter((p) => p.corner === 'above');
  // The leader is what makes a lifted label readable: without a longer
  // offset it would end a row short of the anchor it belongs to.
  assert.ok(
    Math.abs(above[2].leaderOffset) > Math.abs(above[0].leaderOffset),
    'a higher row needs a longer leader than the row beneath it',
  );
});

test('stacking also works downward, for labels that start below their anchor', () => {
  const steps = placementVariants({
    ...base,
    anchorX: 500,
    anchorY: 20,
    preferred: 'below',
    stackSteps: 3,
  });
  const below = steps.filter((p) => p.corner === 'below');
  assert.ok(below.length >= 3);
  assert.equal(below[1].rect.y, below[0].rect.y + 16 + 12);
  assert.ok(below[1].leaderOffset > below[0].leaderOffset);
});

test('stack steps stay inside the viewport', () => {
  const steps = placementVariants({
    ...base,
    anchorX: 500,
    anchorY: 30,
    stackSteps: 6,
  });
  for (const p of steps) {
    assert.ok(p.rect.y >= 4, `row ${p.corner}@${p.rect.y} escaped the top`);
    assert.ok(p.rect.y + 16 <= 800 - 4);
  }
});

test('no stackSteps keeps the shipped four placements', () => {
  const steps = placementVariants({ ...base, anchorX: 500, anchorY: 400 });
  assert.equal(steps.length, 4);
});
