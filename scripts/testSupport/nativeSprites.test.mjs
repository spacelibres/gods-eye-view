import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from 'cesium';
import { visitTargetSprites } from './nativeSprites.mjs';

test('QA native traversal reads source billboards/points without changing their positions or offsets', () => {
  const root = new C.PrimitiveCollection();
  try {
    const billboards = root.add(new C.BillboardCollection()),
      points = root.add(new C.PointPrimitiveCollection());
    const billboard = billboards.add({
      id: 'plane',
      image: 'image',
      position: new C.Cartesian3(1, 2, 3),
      pixelOffset: new C.Cartesian2(2, 4),
    });
    const point = points.add({
      id: 25544,
      position: new C.Cartesian3(4, 5, 6),
    });
    const rows = [];
    visitTargetSprites(root, (sprite, _collection, isPoint) =>
      rows.push([sprite, isPoint]),
    );
    assert.deepEqual(rows, [
      [billboard, false],
      [point, true],
    ]);
    assert.deepEqual(billboard.pixelOffset, new C.Cartesian2(2, 4));
    assert.equal(billboards.length, 1);
    assert.equal(points.length, 1);
    billboards.show = false;
    rows.length = 0;
    visitTargetSprites(root, (sprite) => rows.push(sprite));
    assert.deepEqual(rows, [point]);
  } finally {
    root.destroy();
  }
});
test('QA traversal tolerates boolean lifecycle flags and excludes glyph-like collections', () => {
  const sprite = {
    show: true,
    image: 'icon',
    pixelOffset: { x: 0, y: 0 },
    computeScreenSpacePosition() {},
  };
  const collection = {
    show: true,
    isDestroyed: false,
    length: 1,
    get: () => sprite,
  };
  const rows = [];
  assert.doesNotThrow(() =>
    visitTargetSprites(collection, (s) => rows.push(s)),
  );
  assert.deepEqual(rows, [sprite]);
  collection.isDestroyed = true;
  rows.length = 0;
  visitTargetSprites(collection, (s) => rows.push(s));
  assert.deepEqual(rows, []);
  const labels = { show: true, length: 1, get: () => ({ glyph: true }) };
  visitTargetSprites(labels, (s) => rows.push(s));
  assert.deepEqual(rows, []);
});
