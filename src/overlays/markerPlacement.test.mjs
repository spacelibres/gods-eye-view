import test from 'node:test';
import assert from 'node:assert/strict';
import { placeTargetMarkers } from './markerPlacement.js';

const markers = (count, x = 200, y = 200) =>
  Array.from({ length: count }, (_, i) => ({ id: String(i), x, y, size: 28 }));
function separated(items, width, height) {
  const visible = items.filter((p) => p.visible);
  for (const [i, a] of visible.entries()) {
    assert.ok(a.x - a.size / 2 >= 0 && a.x + a.size / 2 <= width);
    assert.ok(a.y - a.size / 2 >= 0 && a.y + a.size / 2 <= height);
    for (const b of visible.slice(i + 1))
      assert.ok(
        Math.abs(a.x - b.x) >= (a.size + b.size) / 2 + 6 ||
          Math.abs(a.y - b.y) >= (a.size + b.size) / 2 + 6,
        `${a.id} overlaps ${b.id}`,
      );
  }
}
test('dense targets are thinned to one representative rather than spread into a fan', () => {
  const input = markers(30);
  const result = placeTargetMarkers(input, 500, 500);
  assert.equal(result.filter((p) => p.visible).length, 1);
  separated(result, 500, 500);
  assert.equal(result[0].dx, 0);
  assert.ok(result.some((p) => p.dx || p.dy));
  assert.ok(input.every((p) => p.x === 200 && p.y === 200));
});
test('edge targets suppress out-of-bounds icons instead of introducing horizontal drift', () => {
  const input = markers(20, 3, 3);
  const first = placeTargetMarkers(input, 390, 844);
  separated(first, 390, 844);
  assert.ok(first.every((p) => !p.visible));
  const previous = new Map(first.map((p) => [p.id, p]));
  assert.deepEqual(placeTargetMarkers(input, 390, 844, { previous }), first);
});
test('selected carrier wins capacity and crowded overflow never overlaps', () => {
  const result = placeTargetMarkers(markers(1200, 20, 50), 40, 80, {
    selectedId: '1199',
  });
  assert.deepEqual(
    result.filter((p) => p.visible).map((p) => p.id),
    ['1199'],
  );
  separated(result, 40, 80);
});
test('isolated markers use a modest vertical lift and nonfinite anchors stay hidden', () => {
  const input = [
    { id: 'a', x: 50, y: 50, size: 20 },
    { id: 'bad', x: NaN, y: 0, size: 20 },
  ];
  const result = placeTargetMarkers(input, 100, 100, {
    previous: new Map([['a', { dx: 20, dy: 20 }]]),
  });
  assert.equal(result[0].dx, 0);
  assert.equal(result[0].dy, -24);
  assert.equal(result[1].visible, false);
});

test('shared card and chrome rectangles reserve space before target icons', () => {
  const result = placeTargetMarkers(markers(5), 500, 500, {
    obstacles: [{ x: 170, y: 170, w: 60, h: 60 }],
  });
  separated(result, 500, 500);
  for (const p of result.filter((p) => p.visible))
    assert.ok(
      p.x + p.size / 2 + 6 <= 170 ||
        p.x - p.size / 2 >= 236 ||
        p.y + p.size / 2 + 6 <= 170 ||
        p.y - p.size / 2 >= 236,
    );
});

test('zoomed-out targets thin while separated targets reappear with vertical-only short leaders', () => {
  const dense = markers(20),
    zoomed = dense.map((p, i) => ({
      ...p,
      x: 40 + (i % 5) * 80,
      y: 100 + Math.floor(i / 5) * 80,
    }));
  assert.equal(
    placeTargetMarkers(dense, 500, 500).filter((p) => p.visible).length,
    1,
  );
  const result = placeTargetMarkers(zoomed, 500, 500);
  assert.equal(result.filter((p) => p.visible).length, 20);
  for (const p of result.filter((p) => p.visible)) {
    assert.equal(p.dx, 0);
    assert.ok(p.dy <= 0 && p.dy >= -64);
  }
  separated(result, 500, 500);
});
