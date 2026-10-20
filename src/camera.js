import * as Cesium from 'cesium';

import { GLOBE_VIEW } from './locations.js';

/**
 * Where the app opens: the whole Earth, centred so both hemispheres are in
 * view, looking straight down from the app's own full-earth height.
 *
 * The height is `GLOBE_VIEW`, so the first frame is already in the 'global'
 * view-scale band and every policy that reads the scale — context budgets,
 * screenshot framing, voice — agrees with what is on screen from the start.
 *
 * The camera is placed, not flown: a fly-in from a nearby point would spend
 * the first seconds over one city while the loading screen claims the world is
 * ready.
 *
 * @param {object} viewer The Cesium viewer.
 * @returns {Function} A no-op disposer, kept so callers can treat it the same
 *   way as any other startup resource.
 */
export function showFullGlobe(viewer) {
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(
      // Null Island would look arbitrary; this puts Africa and Europe in view,
      // which is what people in both hemispheres recognise as "the world".
      20,
      10,
      GLOBE_VIEW.heightM,
    ),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(GLOBE_VIEW.pitchDeg),
      roll: 0,
    },
  });
  return () => {};
}
