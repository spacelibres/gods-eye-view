import * as Cesium from 'cesium';
import { placeTargetMarkers } from './markerPlacement.js';
import { getWorldOverlayPaintRects } from './worldOverlay.js';

const POINT_IMAGE =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="white"/></svg>',
  );
// Keep source show/cluster flags authoritative, including dynamic reclustering.
const HIDDEN_SPRITE_FADE = new Cesium.NearFarScalar(0, 0, 1e12, 0);
const ringImages = new Map();
function pointRingImage(bodySize, totalSize) {
  const ratio = Math.max(
    0,
    Math.min(63, Math.round((bodySize / totalSize) * 64)),
  );
  if (!ringImages.has(ratio)) {
    const stroke = 16 * (1 - ratio / 64);
    ringImages.set(
      ratio,
      'data:image/svg+xml,' +
        encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="${16 - stroke / 2}" fill="none" stroke="white" stroke-width="${stroke}"/></svg>`,
        ),
    );
  }
  return ringImages.get(ratio);
}
const MAX_CANDIDATES = 2400;
const nearFar = (scalar, distance) => {
  if (!scalar) return 1;
  const t = Math.max(
    0,
    Math.min(
      1,
      (distance * distance - scalar.near * scalar.near) /
        (scalar.far * scalar.far - scalar.near * scalar.near),
    ),
  );
  return (
    scalar.nearValue + (scalar.farValue - scalar.nearValue) * Math.pow(t, 0.2)
  );
};

// Some scene primitives expose a boolean lifecycle flag, rather than Cesium's
// method. Optional-call only guards nullish values, not non-callable members.
function primitiveDestroyed(primitive) {
  const flag = primitive?.isDestroyed;
  return typeof flag === 'function' ? flag.call(primitive) : flag === true;
}

/** Public collection traversal deliberately excludes LabelCollection glyphs and 3D geometry. */
export function visitTargetSprites(collection, visit, excluded) {
  if (
    !collection ||
    collection === excluded ||
    collection.show === false ||
    primitiveDestroyed(collection)
  )
    return;
  const first =
    typeof collection.get === 'function' && collection.length > 0
      ? collection.get(0)
      : null;
  const point =
    collection instanceof Cesium.PointPrimitiveCollection ||
    (first &&
      typeof first.computeScreenSpacePosition === 'function' &&
      typeof first.pixelSize === 'number');
  const billboard =
    collection instanceof Cesium.BillboardCollection ||
    (first &&
      typeof first.computeScreenSpacePosition === 'function' &&
      'image' in first &&
      'pixelOffset' in first);
  if (billboard || point) {
    for (let i = 0; i < collection.length; i++)
      visit(collection.get(i), collection, point);
  } else if (
    collection instanceof Cesium.EntityCluster ||
    (typeof collection.getBillboard === 'function' &&
      typeof collection.getPoint === 'function')
  ) {
    // Engine compatibility seam: entity visualizers keep their native sprites
    // inside EntityCluster, which has no public child-collection iterator.
    visitTargetSprites(collection._billboardCollection, visit, excluded);
    visitTargetSprites(collection._pointCollection, visit, excluded);
    visitTargetSprites(collection._clusterBillboardCollection, visit, excluded);
    visitTargetSprites(collection._clusterPointCollection, visit, excluded);
  } else if (
    collection instanceof Cesium.PrimitiveCollection ||
    (typeof collection.get === 'function' &&
      typeof collection.length === 'number')
  ) {
    for (let i = 0; i < collection.length; i++)
      visitTargetSprites(collection.get(i), visit, excluded);
  }
}

/** One collision domain for all native target icons, independent of layer/source. */
export function createTargetMarkerLayout(
  viewer,
  {
    getObstacles = getWorldOverlayPaintRects,
    getSelectedId = () => viewer.selectedEntity?.id,
  } = {},
) {
  const scene = viewer.scene,
    host = scene.canvas;
  if (
    !host?.parentElement ||
    !scene.preRender ||
    typeof document === 'undefined'
  )
    return () => {};
  const canvas = document.createElement('canvas');
  canvas.className = 'target-marker-leaders';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'absolute',
    pointerEvents: 'none',
    zIndex: '1',
  });
  host.parentElement.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return () => {};
  }
  const proxies = scene.primitives.add(new Cesium.BillboardCollection());
  const states = new Map();
  let serial = 0,
    previous = new Map();
  const world = new Cesium.Cartesian3(),
    scratch = new Cesium.Cartesian2();
  const occluder = new Cesium.EllipsoidalOccluder(
    scene.globe?.ellipsoid || Cesium.Ellipsoid.WGS84,
  );
  const hideProxies = (state) => {
    if (state.proxy) state.proxy.show = false;
    if (state.outlineProxy) state.outlineProxy.show = false;
  };
  const restore = (sprite, state) => {
    if (state.proxy) proxies.remove(state.proxy);
    if (state.outlineProxy) proxies.remove(state.outlineProxy);
    if (primitiveDestroyed(state.collection)) return;
    if (
      Cesium.NearFarScalar.equals(
        sprite.translucencyByDistance,
        HIDDEN_SPRITE_FADE,
      )
    )
      sprite.translucencyByDistance = state.baseFade;
    if (
      !state.point &&
      state.applied &&
      Cesium.Cartesian2.equals(sprite.pixelOffset, state.applied)
    )
      sprite.pixelOffset = state.baseOffset;
  };
  let active = true,
    reorderQueued = false,
    remove,
    listenerCount;
  const onFrame = () => {
    // Layers may attach animation listeners after startup. Run after them so
    // bounds, leaders and offsets use this frame's final target positions.
    if (!reorderQueued && scene.preRender.numberOfListeners !== listenerCount) {
      reorderQueued = true;
      queueMicrotask(() => {
        reorderQueued = false;
        if (!active) return;
        remove();
        remove = scene.preRender.addEventListener(onFrame);
        listenerCount = scene.preRender.numberOfListeners;
        scene.requestRender();
      });
    }
    const width = host.clientWidth,
      height = host.clientHeight,
      dpr = globalThis.devicePixelRatio || 1;
    if (!width || !height) return;
    if (
      canvas.width !== Math.round(width * dpr) ||
      canvas.height !== Math.round(height * dpr)
    ) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    Object.assign(canvas.style, {
      left: `${host.offsetLeft}px`,
      top: `${host.offsetTop}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const seen = new Set(),
      candidates = [],
      byId = new Map(),
      anchors = new Map();
    const selectedId = getSelectedId();
    let selectedKey,
      selectedRank = 0,
      changed = false;
    occluder.cameraPosition = viewer.camera.positionWC;
    visitTargetSprites(
      scene.primitives,
      (sprite, collection, point) => {
        if (!sprite.show) return;
        let state = states.get(sprite);
        if (!state) {
          state = {
            key: String(++serial),
            collection,
            point,
            baseFade: Cesium.NearFarScalar.clone(sprite.translucencyByDistance),
            baseOffset: point
              ? null
              : Cesium.Cartesian2.clone(sprite.pixelOffset),
          };
          states.set(sprite, state);
        }
        seen.add(sprite);
        if (
          !Cesium.NearFarScalar.equals(
            sprite.translucencyByDistance,
            HIDDEN_SPRITE_FADE,
          )
        )
          state.baseFade = Cesium.NearFarScalar.clone(
            sprite.translucencyByDistance,
          );
        if (!sprite.clusterShow) {
          hideProxies(state);
          return;
        }
        if (
          !point &&
          (!state.applied ||
            !Cesium.Cartesian2.equals(sprite.pixelOffset, state.applied))
        )
          state.baseOffset = Cesium.Cartesian2.clone(
            sprite.pixelOffset,
            state.baseOffset,
          );
        Cesium.Matrix4.multiplyByPoint(
          collection.modelMatrix,
          sprite.position,
          world,
        );
        const activeMatch =
          selectedId != null &&
          (sprite.id === selectedId ||
            sprite.id?.id === selectedId ||
            ((typeof sprite.id === 'string' || typeof sprite.id === 'number') &&
              typeof selectedId === 'string' &&
              selectedId.endsWith(`:${sprite.id}`)));
        const rank = activeMatch
          ? 3
          : viewer.trackedEntity && sprite.id === viewer.trackedEntity
            ? 2
            : viewer.selectedEntity && sprite.id === viewer.selectedEntity
              ? 1
              : 0;
        const isSelected = rank > 0;
        const p =
          (scene.mode !== Cesium.SceneMode.SCENE3D ||
            occluder.isPointVisible(world)) &&
          (point
            ? scene.cartesianToCanvasCoordinates(world, scratch)
            : sprite.computeScreenSpacePosition(scene, scratch));
        const projectedX =
          p && p.x + (point ? 0 : state.baseOffset.x - sprite.pixelOffset.x);
        const projectedY =
          p && p.y + (point ? 0 : state.baseOffset.y - sprite.pixelOffset.y);
        if (
          !p ||
          projectedX < 0 ||
          projectedY < 0 ||
          projectedX > width ||
          projectedY > height
        ) {
          hideProxies(state);
          return;
        }
        let x = p.x,
          y = p.y;
        if (!point) {
          x += state.baseOffset.x - sprite.pixelOffset.x;
          y += state.baseOffset.y - sprite.pixelOffset.y;
        }
        const distance = Cesium.Cartesian3.distance(
          viewer.camera.positionWC,
          world,
        );
        const scale =
          nearFar(sprite.scaleByDistance, distance) *
          (point ? 1 : sprite.scale);
        const pixelFactor = point
          ? 1
          : nearFar(sprite.pixelOffsetScaleByDistance, distance);
        if (!point) {
          x += state.baseOffset.x * (pixelFactor - 1);
          y += state.baseOffset.y * (pixelFactor - 1);
        }
        state.pixelFactor = pixelFactor;
        const originX = point
          ? 0
          : (sprite.horizontalOrigin * (sprite.width || 32) * scale) / 2;
        const originY = point
          ? 0
          : (-Math.sign(sprite.verticalOrigin) *
              (sprite.height || 32) *
              scale) /
            2;
        x += originX;
        y += originY;
        const size = Math.max(
          8,
          point
            ? (sprite.pixelSize + sprite.outlineWidth * 2) * scale + 3
            : Math.max(sprite.width || 32, sprite.height || 32) *
                scale *
                (sprite.rotation ? Math.SQRT2 : 1),
        );
        state.pointAlpha = nearFar(state.baseFade, distance);
        state.bodySize = point ? Math.max(1, sprite.pixelSize * scale) : 0;
        state.totalSize = point
          ? (sprite.pixelSize + sprite.outlineWidth * 2) * scale
          : 0;
        const alpha =
          point && sprite.outlineWidth > 0
            ? Math.max(sprite.color.alpha, sprite.outlineColor.alpha)
            : sprite.color.alpha;
        const limit = sprite.distanceDisplayCondition;
        if (
          (limit && (distance < limit.near || distance > limit.far)) ||
          alpha * state.pointAlpha < 0.02
        ) {
          hideProxies(state);
          return;
        }
        if (!point && sprite.sizeInMeters) return; // Geometric/model-sized billboards are physical world content.
        if (candidates.length >= MAX_CANDIDATES && !isSelected) {
          if (
            !Cesium.NearFarScalar.equals(
              sprite.translucencyByDistance,
              HIDDEN_SPRITE_FADE,
            )
          ) {
            sprite.translucencyByDistance = HIDDEN_SPRITE_FADE;
            changed = true;
          }
          hideProxies(state);
          return;
        }
        candidates.push({
          id: state.key,
          x,
          y,
          size,
          fixed: pixelFactor < 0.001,
        });
        byId.set(state.key, [sprite, state]);
        anchors.set(state.key, {
          x: x - originX,
          y: y - originY,
          world: point ? Cesium.Cartesian3.clone(world) : null,
        });
        if (rank > selectedRank) {
          selectedKey = state.key;
          selectedRank = rank;
        }
      },
      proxies,
    );
    const layout = placeTargetMarkers(candidates, width, height, {
      previous,
      selectedId: selectedKey,
      obstacles: getObstacles(),
    });
    previous = new Map(layout.map((p) => [p.id, p]));
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    for (const p of layout)
      if (p.visible)
        ctx.rect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    ctx.clip('evenodd');
    for (const p of layout) {
      const [sprite, state] = byId.get(p.id),
        anchor = anchors.get(p.id);
      if (state.point) {
        if (
          !Cesium.NearFarScalar.equals(
            sprite.translucencyByDistance,
            HIDDEN_SPRITE_FADE,
          )
        ) {
          sprite.translucencyByDistance = HIDDEN_SPRITE_FADE;
          changed = true;
        }
        if (!state.proxy)
          state.proxy = proxies.add({ image: POINT_IMAGE, id: sprite.id });
        if (
          !Cesium.Cartesian3.equals(state.proxy.position, anchor.world) ||
          state.proxy.pixelOffset.x !== p.dx ||
          state.proxy.pixelOffset.y !== p.dy ||
          state.proxy.show !== p.visible
        )
          changed = true;
        Object.assign(state.proxy, {
          show: p.visible,
          position: anchor.world,
          width: state.bodySize,
          height: state.bodySize,
          pixelOffset: new Cesium.Cartesian2(p.dx, p.dy),
          color: Cesium.Color.fromAlpha(
            sprite.color,
            sprite.color.alpha * state.pointAlpha,
          ),
          disableDepthTestDistance: sprite.disableDepthTestDistance,
          distanceDisplayCondition: sprite.distanceDisplayCondition,
        });
        if (sprite.outlineWidth > 0) {
          if (!state.outlineProxy)
            state.outlineProxy = proxies.add({ id: sprite.id });
          Object.assign(state.outlineProxy, {
            show: p.visible,
            image: pointRingImage(state.bodySize, state.totalSize),
            position: anchor.world,
            width: state.totalSize,
            height: state.totalSize,
            pixelOffset: new Cesium.Cartesian2(p.dx, p.dy),
            color: Cesium.Color.fromAlpha(
              sprite.outlineColor,
              sprite.outlineColor.alpha * state.pointAlpha,
            ),
            disableDepthTestDistance: sprite.disableDepthTestDistance,
            distanceDisplayCondition: sprite.distanceDisplayCondition,
          });
        } else if (state.outlineProxy) state.outlineProxy.show = false;
      } else {
        const fade = p.visible ? state.baseFade : HIDDEN_SPRITE_FADE;
        if (!Cesium.NearFarScalar.equals(sprite.translucencyByDistance, fade)) {
          sprite.translucencyByDistance = fade;
          changed = true;
        }
        const offset = p.visible
          ? new Cesium.Cartesian2(
              state.baseOffset.x +
                (state.pixelFactor >= 0.001 ? p.dx / state.pixelFactor : 0),
              state.baseOffset.y +
                (state.pixelFactor >= 0.001 ? p.dy / state.pixelFactor : 0),
            )
          : Cesium.Cartesian2.clone(state.baseOffset);
        if (!Cesium.Cartesian2.equals(sprite.pixelOffset, offset)) {
          sprite.pixelOffset = offset;
          changed = true;
        }
        state.applied = offset;
      }
      if (!p.visible || Math.hypot(p.dx, p.dy) < 1) continue;
      const lineX = p.x - anchor.x,
        lineY = p.y - anchor.y;
      const fraction = Math.max(
        0,
        1 - (p.size / 2 + 1) / Math.max(Math.abs(lineX), Math.abs(lineY)),
      );
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y);
      ctx.lineTo(anchor.x + lineX * fraction, anchor.y + lineY * fraction);
      ctx.strokeStyle = sprite.color.toCssColorString();
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
    ctx.restore();
    for (const [sprite, state] of states)
      if (!seen.has(sprite)) {
        restore(sprite, state);
        states.delete(sprite);
      }
    canvas.dataset.visibleCount = String(
      layout.filter((p) => p.visible).length,
    );
    canvas.dataset.displacedCount = String(
      layout.filter((p) => p.visible && (p.dx || p.dy)).length,
    );
    canvas.dataset.pointCount = String(
      layout.filter((p) => byId.get(p.id)[1].point && p.visible).length,
    );
    if (changed) scene.requestRender();
  };
  remove = scene.preRender.addEventListener(onFrame);
  listenerCount = scene.preRender.numberOfListeners;
  return () => {
    if (!active) return;
    active = false;
    remove();
    for (const [sprite, state] of states) restore(sprite, state);
    states.clear();
    scene.primitives.remove(proxies);
    canvas.remove();
  };
}
