/** Resolve server credentials after applying environment overrides per key. */
export function resolveGoogleServerKey(environment = {}, defaults = {}) {
  const value = (name) =>
    String(environment[name] ?? defaults[name] ?? '').trim();
  return value('GOOGLE_MAPS_SERVER_API_KEY') || value('GOOGLE_MAPS_API_KEY');
}

/**
 * Key for the server-side Map Tiles relay.
 *
 * `GOOGLE_MAPS_TILES_API_KEY` exists because the relay and the Places proxy
 * bill different APIs and may use keys from different Cloud projects: a
 * deployment can hold a Map Tiles key without Places access, or the reverse.
 * Unset, it falls back to the Places key so a single-key setup keeps working.
 */
export function resolveGoogleTilesKey(environment = {}, defaults = {}) {
  const value = (name) =>
    String(environment[name] ?? defaults[name] ?? '').trim();
  return (
    value('GOOGLE_MAPS_TILES_API_KEY') ||
    value('GOOGLE_MAPS_SERVER_API_KEY') ||
    value('GOOGLE_MAPS_API_KEY')
  );
}
