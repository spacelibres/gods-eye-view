import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveGoogleServerKey,
  resolveGoogleTilesKey,
} from '../scripts/google-server-key.mjs';

/**
 * The Places proxy and the Map Tiles relay bill different Google APIs and may
 * use keys from different Cloud projects, so each resolves its own variable.
 * Both fall back the way they always did, so a single-key deployment is
 * unaffected.
 */

const TILES = 'tiles-key';
const SERVER = 'server-key';
const BROWSER = 'browser-key';

test('the relay prefers its own key over the Places key', () => {
  assert.equal(
    resolveGoogleTilesKey({
      GOOGLE_MAPS_TILES_API_KEY: TILES,
      GOOGLE_MAPS_SERVER_API_KEY: SERVER,
      GOOGLE_MAPS_API_KEY: BROWSER,
    }),
    TILES,
  );
});

test('the relay falls back to the Places key, then the browser key', () => {
  assert.equal(
    resolveGoogleTilesKey({
      GOOGLE_MAPS_SERVER_API_KEY: SERVER,
      GOOGLE_MAPS_API_KEY: BROWSER,
    }),
    SERVER,
  );
  assert.equal(resolveGoogleTilesKey({ GOOGLE_MAPS_API_KEY: BROWSER }), BROWSER);
});

test('the Places proxy never picks up the relay key', () => {
  assert.equal(
    resolveGoogleServerKey({
      GOOGLE_MAPS_TILES_API_KEY: TILES,
      GOOGLE_MAPS_SERVER_API_KEY: SERVER,
      GOOGLE_MAPS_API_KEY: BROWSER,
    }),
    SERVER,
  );
  // A relay-only key must not become the Places key by accident.
  assert.equal(
    resolveGoogleServerKey({
      GOOGLE_MAPS_TILES_API_KEY: TILES,
      GOOGLE_MAPS_API_KEY: BROWSER,
    }),
    BROWSER,
  );
});

test('blank values are skipped, not returned', () => {
  assert.equal(
    resolveGoogleTilesKey({
      GOOGLE_MAPS_TILES_API_KEY: '   ',
      GOOGLE_MAPS_SERVER_API_KEY: SERVER,
    }),
    SERVER,
  );
  assert.equal(resolveGoogleTilesKey({}), '');
});
