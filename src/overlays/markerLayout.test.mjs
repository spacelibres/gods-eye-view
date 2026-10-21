import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from 'cesium';
import {
  createTargetMarkerLayout,
  visitTargetSprites,
} from './markerLayout.js';

function harness(options = {}) {
  const originalDocument = globalThis.document;
  const calls = [];
  const ctx = new Proxy(
    {},
    {
      get:
        (_, name) =>
        (...args) =>
          calls.push([name, ...args]),
      set: () => true,
    },
  );
  const canvases = [];
  globalThis.document = {
    createElement: () => ({
      style: {},
      dataset: {},
      setAttribute() {},
      getContext: () => ctx,
      remove() {
        canvases.splice(canvases.indexOf(this), 1);
      },
    }),
  };
  const primitives = new C.PrimitiveCollection();
  const event = new C.Event();
  const viewer = {
    camera: { positionWC: new C.Cartesian3(7000000, 0, 0) },
    scene: {
      mode: C.SceneMode.SCENE2D,
      cartesianToCanvasCoordinates: () => new C.Cartesian2(260, 200),
      primitives,
      preRender: event,
      requestRender() {},
      canvas: {
        clientWidth: 500,
        clientHeight: 500,
        offsetLeft: 0,
        offsetTop: 0,
        parentElement: {
          appendChild(c) {
            canvases.push(c);
          },
        },
      },
    },
  };
  const collection = primitives.add(new C.BillboardCollection());
  const points = primitives.add(new C.PointPrimitiveCollection());
  let nextX = 80;
  const add = (id, point = false) => {
    const originX = nextX;
    nextX += 90;
    const sprite = (point ? points : collection).add({
      id,
      position: new C.Cartesian3(6378137, 0, 0),
      image: 'icon',
      width: 28,
      height: 28,
      pixelSize: 20,
    });
    sprite.computeScreenSpacePosition = () =>
      new C.Cartesian2(
        originX + (sprite.pixelOffset?.x || 0),
        200 + (sprite.pixelOffset?.y || 0),
      );
    return sprite;
  };
  const dispose = createTargetMarkerLayout(viewer, {
    getObstacles: () => [],
    ...options,
  });
  return {
    viewer,
    event,
    primitives,
    collection,
    points,
    add,
    canvases,
    calls,
    dispose,
    cleanup() {
      dispose();
      primitives.destroy();
      globalThis.document = originalDocument;
    },
  };
}
test('shared native sprites and point proxies separate across collections without changing positions or source show', () => {
  const h = harness();
  try {
    const a = h.add('airport'),
      b = h.add('vessel'),
      point = h.add(25544, true);
    const position = C.Cartesian3.clone(point.position);
    h.event.raiseEvent();
    assert.equal(h.canvases[0].dataset.visibleCount, '3');
    assert.equal(h.canvases[0].dataset.pointCount, '1');
    assert.ok(Number(h.canvases[0].dataset.displacedCount) > 0);
    assert.ok(a.show && b.show && point.show);
    assert.deepEqual(point.position, position);
    assert.equal(point.clusterShow, true);
    assert.equal(point.translucencyByDistance.nearValue, 0);
    const proxy = h.primitives.get(h.primitives.length - 1).get(0);
    assert.equal(proxy.id, 25544);
    assert.ok(h.calls.some(([name]) => name === 'lineTo'));
    h.points.show = false;
    h.event.raiseEvent();
    assert.equal(point.clusterShow, true);
    assert.equal(h.canvases[0].dataset.pointCount, '0');
  } finally {
    h.cleanup();
  }
  assert.equal(h.canvases.length, 0);
  assert.equal(h.event.numberOfListeners, 0);
});
test('source-hidden icons stay hidden and cleanup restores authored pixel offsets and cluster flags', () => {
  const h = harness();
  try {
    const a = h.add('a'),
      b = h.add('b'),
      hidden = h.add('hidden');
    a.pixelOffset = new C.Cartesian2(2, 3);
    hidden.show = false;
    h.event.raiseEvent();
    assert.equal(h.canvases[0].dataset.visibleCount, '2');
    assert.equal(hidden.show, false);
    b.show = false;
    h.event.raiseEvent();
    assert.equal(h.canvases[0].dataset.visibleCount, '1');
    assert.equal(b.show, false);
    assert.equal(b.clusterShow, true);
    assert.ok(a.show);
  } finally {
    h.cleanup();
  }
});
test('public traversal skips inactive nested groups and glyph-like collections', () => {
  const root = new C.PrimitiveCollection();
  const nested = root.add(new C.PrimitiveCollection());
  const markers = nested.add(new C.PointPrimitiveCollection());
  markers.add({ position: C.Cartesian3.ZERO, id: 'x' });
  const ids = [];
  visitTargetSprites(root, (p) => ids.push(p.id));
  assert.deepEqual(ids, ['x']);
  nested.show = false;
  ids.length = 0;
  visitTargetSprites(root, (p) => ids.push(p.id));
  assert.deepEqual(ids, []);
  root.destroy();
});

test('entity visualizer clusters expose marker sprites but never label glyphs', () => {
  const root = new C.PrimitiveCollection();
  const cluster = root.add(new C.EntityCluster());
  cluster._billboardCollection = new C.BillboardCollection();
  cluster._billboardCollection.add({
    id: 'airport-entity',
    position: C.Cartesian3.ZERO,
  });
  cluster._pointCollection = new C.PointPrimitiveCollection();
  cluster._pointCollection.add({
    id: 'earthquake-entity',
    position: C.Cartesian3.ZERO,
  });
  const ids = [];
  visitTargetSprites(root, (p) => ids.push(p.id));
  assert.deepEqual(ids, ['airport-entity', 'earthquake-entity']);
  root.destroy();
});

test('layout runs after animation listeners added later and teardown is idempotent', async () => {
  const h = harness();
  try {
    const a = h.add('moving-a'),
      b = h.add('moving-b');
    let x = 200;
    a.computeScreenSpacePosition = b.computeScreenSpacePosition = function () {
      return new C.Cartesian2(x + this.pixelOffset.x, 200 + this.pixelOffset.y);
    };
    h.event.addEventListener(() => {
      x = 350;
    });
    h.event.raiseEvent();
    await Promise.resolve();
    h.calls.length = 0;
    h.event.raiseEvent();
    assert.ok(
      h.calls.some(([method, px]) => method === 'moveTo' && px === 350),
    );
    h.dispose();
    h.dispose();
  } finally {
    h.cleanup();
  }
});

test('destroying a source collection removes its visible point proxies without ghost targets', () => {
  const h = harness();
  try {
    h.add('point', true);
    h.event.raiseEvent();
    const proxies = h.primitives.get(h.primitives.length - 1);
    assert.equal(proxies.length, 1);
    h.primitives.remove(h.points);
    h.event.raiseEvent();
    assert.equal(proxies.length, 0);
    assert.equal(h.canvases[0].dataset.visibleCount, '0');
  } finally {
    h.cleanup();
  }
});

test('source clustering remains authoritative during unclustered to clustered transitions', () => {
  const h = harness();
  try {
    const point = h.add('radio', true);
    h.event.raiseEvent();
    assert.equal(point.clusterShow, true);
    point.clusterShow = false;
    h.event.raiseEvent();
    assert.equal(h.canvases[0].dataset.visibleCount, '0');
    assert.equal(h.primitives.get(h.primitives.length - 1).get(0).show, false);
    point.clusterShow = true;
    h.event.raiseEvent();
    assert.equal(h.canvases[0].dataset.visibleCount, '1');
  } finally {
    h.cleanup();
  }
});
test('point proxies preserve evaluated distance alpha and authored zero or colored outlines', () => {
  const h = harness();
  try {
    const point = h.add('fade', true);
    point.translucencyByDistance = new C.NearFarScalar(1, 1, 1000000, 0);
    h.event.raiseEvent();
    const collection = h.primitives.get(h.primitives.length - 1),
      body = collection.get(0);
    assert.ok(body.color.alpha > 0 && body.color.alpha < 1);
    assert.equal(collection.length, 1);
    assert.doesNotMatch(decodeURIComponent(body.image), /stroke=/);
    point.outlineWidth = 2;
    point.outlineColor = C.Color.RED;
    h.event.raiseEvent();
    assert.equal(collection.length, 2);
    const ring = collection.get(1);
    assert.equal(ring.color.red, 1);
    assert.equal(ring.color.green, 0);
    assert.equal(ring.color.alpha, body.color.alpha);
    assert.ok(ring.width > body.width);
    assert.equal(point.clusterShow, true);
  } finally {
    h.cleanup();
  }
});

test('sparse overflow suppression works even when billboard offset scaling is zero', () => {
  const h = harness();
  try {
    const a = h.add('a'),
      b = h.add('b');
    a.computeScreenSpacePosition = b.computeScreenSpacePosition = () =>
      new C.Cartesian2(200, 200);
    a.pixelOffsetScaleByDistance = b.pixelOffsetScaleByDistance =
      new C.NearFarScalar(0, 0, 1000000, 0);
    h.event.raiseEvent();
    assert.equal(h.canvases[0].dataset.visibleCount, '1');
    assert.equal(b.translucencyByDistance.nearValue, 0);
    assert.equal(a.clusterShow, true);
    assert.equal(b.clusterShow, true);
  } finally {
    h.cleanup();
  }
});

test('numeric satellite identity wins sparse placement when selected through a namespaced context', () => {
  const h = harness();
  try {
    const ordinary = h.add('ordinary'),
      point = h.add(25544, true);
    ordinary.computeScreenSpacePosition = () => new C.Cartesian2(260, 200);
    h.viewer.selectedEntity = { id: 'satellite:25544' };
    h.event.raiseEvent();
    assert.equal(h.canvases[0].dataset.visibleCount, '1');
    assert.equal(h.canvases[0].dataset.pointCount, '1');
    assert.equal(ordinary.translucencyByDistance.nearValue, 0);
  } finally {
    h.cleanup();
  }
});
test('active tracked readout gets priority over an older selected entity at the same anchor', () => {
  const h = harness({ getSelectedId: () => 'tracked' });
  try {
    const old = h.add({ id: 'old' }),
      tracked = h.add({ id: 'tracked' });
    old.computeScreenSpacePosition = tracked.computeScreenSpacePosition = () =>
      new C.Cartesian2(200, 200);
    h.viewer.selectedEntity = old.id;
    h.viewer.trackedEntity = tracked.id;
    h.event.raiseEvent();
    assert.equal(old.translucencyByDistance.nearValue, 0);
    assert.equal(tracked.translucencyByDistance, undefined);
  } finally {
    h.cleanup();
  }
});

test('mixed scene primitives may expose boolean lifecycle flags without stopping render traversal', () => {
  const marker = { computeScreenSpacePosition() {}, pixelSize: 12 };
  const leaf = { show: true, isDestroyed: false };
  const nested = {
    show: true,
    isDestroyed: false,
    length: 2,
    get: (i) =>
      i === 0 ? leaf : { length: 1, get: () => marker, isDestroyed: 0 },
  };
  const seen = [];
  assert.doesNotThrow(() => visitTargetSprites(nested, (s) => seen.push(s)));
  assert.deepEqual(seen, [marker]);
  nested.isDestroyed = true;
  seen.length = 0;
  visitTargetSprites(nested, (s) => seen.push(s));
  assert.equal(seen.length, 0);
});
