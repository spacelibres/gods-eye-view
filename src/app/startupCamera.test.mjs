import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';

import { showFullGlobe } from '../camera.js';
import { GLOBE_VIEW } from '../locations.js';

/** A viewer that records the view it was placed at. */
function viewer() {
  const views = [];
  const flights = [];
  return {
    isDestroyed: () => false,
    camera: {
      setView(options) {
        views.push(options);
      },
      flyTo(options) {
        flights.push(options);
      },
      cancelFlight() {},
    },
    views,
    flights,
  };
}

test('the app opens on the whole globe, at the app’s own full-earth height', () => {
  const v = viewer();
  showFullGlobe(v);

  assert.equal(v.views.length, 1, 'the camera is placed once');
  const view = v.views[0];
  // The full-earth preset, not a local view: anything below the 'global'
  // view-scale band would make context budgets and screenshots treat the
  // opening frame as a zoomed-in place.
  const carto = Cesium.Cartographic.fromCartesian(view.destination);
  assert.equal(Math.round(carto.height), GLOBE_VIEW.heightM);
  // Straight down on a full-earth view; a tilted one would show horizon sky.
  assert.equal(view.orientation.pitch, (GLOBE_VIEW.pitchDeg * Math.PI) / 180);
  assert.equal(view.orientation.heading, 0);
  assert.equal(view.orientation.roll, 0);
});

test('the opening view is placed, not flown', () => {
  const v = viewer();
  showFullGlobe(v);
  // A flight would spend its first seconds moving; the loading screen has
  // already promised the world.
  assert.equal(v.flights.length, 0);
});
