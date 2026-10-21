import test from 'node:test';
import assert from 'node:assert/strict';
import {
  movingTargetLevel,
  registerMovingTarget,
  getMovingTargetPresentation,
  publishMovingTargetPresentation,
} from './movingTargetPresentation.js';

test('aircraft and satellites reveal detail at their own distance bands', () => {
  for (const [kind, far, near] of [
    ['AIR', 1500000, 150000],
    ['SAT', 30000000, 3000000],
  ]) {
    assert.equal(movingTargetLevel(kind, far * 2), 0);
    assert.equal(movingTargetLevel(kind, (far + near) / 2), 1);
    assert.equal(movingTargetLevel(kind, near / 2), 2);
    assert.equal(movingTargetLevel(kind, far * 2, undefined, true), 2);
  }
});
test('level transitions have hysteresis and can jump directly across bands', () => {
  assert.equal(movingTargetLevel('AIR', 1400000, 0), 0);
  assert.equal(movingTargetLevel('AIR', 1100000, 0), 1);
  assert.equal(movingTargetLevel('AIR', 160000, 2), 2);
  assert.equal(movingTargetLevel('AIR', 190000, 2), 1);
  assert.equal(movingTargetLevel('AIR', 10000, 0), 2);
  assert.equal(movingTargetLevel('AIR', 5000000, 2), 0);
});
test('native sprites and entity sprites share an explicit registration without inferring target type from ids', () => {
  const entity = {},
    sprite = { id: entity };
  registerMovingTarget(entity, 'AIR');
  assert.equal(getMovingTargetPresentation(sprite).kind, 'AIR');
  publishMovingTargetPresentation(sprite, {
    visible: true,
    level: 0,
    visual: { id: entity },
  });
  assert.equal(getMovingTargetPresentation(sprite).frame.level, 0);
  assert.equal(getMovingTargetPresentation({ id: 'abc123' }), null);
});
