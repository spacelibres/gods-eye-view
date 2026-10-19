/**
 * Can this browser reach Google's tiles on its own?
 *
 * `tile.googleapis.com` answers in well under a second from most networks and
 * times out from some (measured: 0.11 s from the app server, no answer at all
 * from a mainland-China connection). Which one a visitor gets is a property of
 * their network, not of the deployment, so it is measured per page load with a
 * deadline short enough not to hold up the globe.
 *
 * A probe that fails asks for the same-origin relay instead
 * (`/api/google/tiles`), which asks Google from the app server. A probe that
 * succeeds always wins: it keeps the tile session between the browser and
 * Google and costs the server nothing.
 */

/** Same-origin mount of the relay; matches the server route. */
export const TILES_RELAY_PATH = '/api/google/tiles';

/** How long Google gets to answer the probe. */
export const PROBE_TIMEOUT_MS = 3000;

/**
 * Google's tileset root, asked with the key the app actually uses.
 *
 * The probe must send a key that works: Google answers an invalid one with
 * `400`, and so does a local proxy that refuses the host, so a placeholder
 * key cannot tell "Google rejected my key" from "I never reached Google".
 * With the real key a `200` means Google is reachable and the key is good —
 * which is exactly what the tiles need.
 *
 * @param {string} apiKey The same key the tileset will use.
 * @returns {string} The probe URL.
 */
export function probeUrl(apiKey) {
  const url = new URL('https://tile.googleapis.com/v1/3dtiles/root.json');
  url.searchParams.set('key', String(apiKey || '').trim());
  return url.toString();
}

/**
 * Decide the route for this page load.
 *
 * @param {{apiKey: string, fetchImpl?: Function, timeoutMs?: number,
 *   relayPath?: string}} options `apiKey` is required: the probe has to ask
 *   Google with a working key for a `200` to mean anything (see probeUrl).
 * @returns {Promise<'direct'|'relayed'>} Never rejects: an unreachable relay
 *   leaves the session on `direct`, where the existing provider fallback runs.
 */
export async function chooseTileRoute({
  apiKey,
  fetchImpl = (...args) => fetch(...args),
  timeoutMs = PROBE_TIMEOUT_MS,
  relayPath = TILES_RELAY_PATH,
} = {}) {
  if (await answers(fetchImpl, probeUrl(apiKey), timeoutMs, (r) => r.ok)) {
    return 'direct';
  }
  return (await answers(fetchImpl, relayPath, timeoutMs, (r) => r.ok))
    ? 'relayed'
    : 'direct';
}

/**
 * Point Cesium's Google tiles at the relay.
 *
 * `createGooglePhotorealistic3DTileset` builds every tile URL from
 * `GoogleMaps.mapTilesApiEndpoint`, so this one setting moves the root, the
 * session and every tile. Cesium appends `?key=` to the root request only, and
 * needs a key to exist for the URL to be built; the relay answers that request
 * with the server's key, so the value below never leaves the app.
 *
 * @param {object} Cesium The SDK namespace.
 * @param {string} relayPath Same-origin mount.
 * @returns {boolean} True when the endpoint was changed.
 */
export function relayGoogleTiles(Cesium, relayPath = TILES_RELAY_PATH) {
  const google = Cesium?.GoogleMaps;
  if (!google) return false;
  const origin = globalThis.location?.origin ?? 'http://localhost';
  google.mapTilesApiEndpoint = new Cesium.Resource({
    url: new URL(`${relayPath}/`, origin).toString(),
  });
  google.defaultApiKey = 'relayed-by-server';
  return true;
}

async function answers(fetchImpl, url, timeoutMs, accept) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // HEAD looks cheaper but is not reliable: Google's edge answers it with a
    // network failure on connections that serve GET in a few hundred
    // milliseconds, which would send every such visitor down the relay path.
    // The body is never read, so only the headers cost anything.
    const response = await fetchImpl(url, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    try {
      await response.body?.cancel();
    } catch {
      // The probe only needed the headers.
    }
    return accept(response);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Undo `relayGoogleTiles`: point Cesium back at Google.
 *
 * The relay is this app's own server, so its failure says nothing about the
 * visitor's path to Google. Restoring the SDK's default URL lets the loader
 * retry Google itself before it gives up on 3D entirely.
 *
 * @param {object} Cesium The SDK namespace.
 * @returns {boolean} True when the endpoint was changed.
 */
export function restoreDirectTiles(Cesium) {
  const google = Cesium?.GoogleMaps;
  if (!google) return false;
  google.mapTilesApiEndpoint = new Cesium.Resource({
    url: 'https://tile.googleapis.com/',
  });
  return true;
}
