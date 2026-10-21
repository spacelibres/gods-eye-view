// Explicit registration keeps fixed sites out of moving-target display policy.
const targets = new WeakMap();
export function registerMovingTarget(sprite, kind) {
  if (sprite && (kind === 'AIR' || kind === 'SAT') && !targets.has(sprite))
    targets.set(sprite, { kind, frame: { visible: false, level: 0 } });
  return sprite;
}
export function getMovingTargetPresentation(sprite) {
  if (!sprite || typeof sprite !== 'object') return null;
  return (
    targets.get(sprite) ||
    (typeof sprite.id === 'object' && targets.get(sprite.id)) ||
    null
  );
}
export function publishMovingTargetPresentation(sprite, frame) {
  const record = getMovingTargetPresentation(sprite);
  if (record) record.frame = frame;
}
export function movingTargetLevel(kind, distance, previous, selected = false) {
  if (selected) return 2;
  const [far, near] = kind === 'SAT' ? [30000000, 3000000] : [1500000, 150000];
  if (previous === 0)
    return distance < near * 0.8 ? 2 : distance < far * 0.8 ? 1 : 0;
  if (previous === 2)
    return distance > far * 1.2 ? 0 : distance > near * 1.2 ? 1 : 2;
  if (previous === 1)
    return distance > far * 1.2 ? 0 : distance < near * 0.8 ? 2 : 1;
  return distance > far ? 0 : distance > near ? 1 : 2;
}
export function movingDetectionPresentation(object, distance) {
  const record = getMovingTargetPresentation(
    object.billboard || object.pointPrimitive,
  );
  if (record && !object.modelOwnsVisual) {
    if (object.skipLabel)
      return {
        visible: true,
        level: 2,
        selected: true,
        visual: record.frame.visible ? record.frame.visual : null,
      };
    return record.frame;
  }
  if (object.movingKind)
    return {
      visible: true,
      level: movingTargetLevel(object.movingKind, distance),
      selected: Boolean(object.skipLabel),
    };
  return null;
}
export function movingTargetLabelsVisible(object) {
  const record = getMovingTargetPresentation(
    object.billboard || object.pointPrimitive,
  );
  if (record && !object.modelOwnsVisual)
    return (
      record.frame.visible &&
      record.frame.level === 2 &&
      !record.frame.selected &&
      !object.skipLabel
    );
  return object._movingLabelEligible !== false;
}
