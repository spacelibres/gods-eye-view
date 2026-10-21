import * as Cesium from 'cesium';

// Read-only traversal for browser QA; never changes native sprite presentation.
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
