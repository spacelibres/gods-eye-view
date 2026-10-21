import {
  resolveGoogleServerKey,
  resolveGoogleTilesKey,
} from '../../../scripts/google-server-key.mjs';

/**
 * Optional Google place context is an empty capability when no key is present,
 * not a server outage. Returning 200 keeps a deliberately keyless session out
 * of the browser error console while preserving an explicit configured flag.
 */
export function keylessGooglePlacesResponse(apiKey) {
  if (String(apiKey ?? '').trim()) return null;
  return {
    statusCode: 200,
    payload: { configured: false, error: null, places: [] },
  };
}

/**
 * Geocoding speaks Google's own response shape rather than the `places: []`
 * contract its two siblings use, because the browser adapters read `status`
 * and `results` directly. The keyless capability reads the same way: a status
 * that is not `OK` and no results, which the adapters already treat as "this
 * provider did not answer" and pass to the next geocoder in the chain.
 */
export function keylessGoogleGeocodeResponse(apiKey) {
  if (String(apiKey ?? '').trim()) return null;
  return {
    statusCode: 200,
    payload: {
      configured: false,
      status: 'REQUEST_DENIED',
      results: [],
      error: null,
    },
  };
}

/**
 * Google API key for the SERVER-SIDE calls (Places nearby/text search,
 * geocoding, the CCTV Street View fallback). These never reach the browser, so
 * this key can be restricted by server IP and scoped to Places API + Geocoding
 * API + Street View Static API — while GOOGLE_MAPS_API_KEY stays
 * referrer-restricted to Map Tiles + Maps JavaScript API for the browser
 * (#33, #363). Splitting them is opt-in: unset, this falls back to the shared
 * browser key, which then has to carry every API both sides use and cannot
 * take a referrer restriction.
 */
export function googleServerApiKey() {
  return resolveGoogleServerKey(process.env);
}

/**
 * Google API key for the SERVER-SIDE tile relay (`/api/google/tiles`).
 *
 * Separate from the Places key because the two keys need different APIs
 * enabled and are often owned by different Cloud projects: a deployment may
 * hold a Map Tiles key it cannot use for Places, and the reverse. Unset, this
 * falls back to the Places key, which is the single-key setup the relay had
 * before the split.
 */
export function googleTilesApiKey(environment = process.env) {
  return resolveGoogleTilesKey(environment);
}
