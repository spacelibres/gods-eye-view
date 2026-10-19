/**
 * The stored palette choice, resolved without touching the DOM.
 *
 * This is the half of the colour system that the first painted frame needs:
 * `src/palette-bootstrap.js` is inlined into `index.html` and runs before the
 * stylesheets, and it imports this module so the loading screen is already in
 * the visitor's palette rather than flashing the default and then correcting
 * itself. `colorSystemRuntime.js` owns everything that needs a document.
 *
 * Imported from a classic inline script, so the extension is explicit.
 */

import { COLOR_MODES, COLOR_PRESETS, normalizeHex } from './colorSystem.js';

/** Durable preference key. Matches the repo convention gev:<name>:v1. */
export const PALETTE_STORAGE_KEY = 'gev:palette:v1';

/** The preset the identity manual ships as its default. */
export const DEFAULT_PRESET = COLOR_PRESETS[0];

function readStored(storage) {
  try {
    const raw = storage?.getItem?.(PALETTE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const primary = normalizeHex(parsed?.primary);
    if (!primary) return null;
    const mode = COLOR_MODES.includes(parsed?.mode) ? parsed.mode : 'auto';
    return { primary, mode };
  } catch {
    return null;
  }
}

function fromQuery(location) {
  try {
    const params = new URLSearchParams(location?.search);
    const primary = normalizeHex(params.get('primary'));
    if (!primary) return null;
    const mode = params.get('mode');
    return {
      primary,
      mode: COLOR_MODES.includes(mode) ? mode : 'auto',
    };
  } catch {
    return null;
  }
}

/**
 * Resolve the palette to use: `?primary=` wins, then the stored choice, then
 * the manual's default preset.
 *
 * @returns {{primary: string, mode: string}}
 */
export function resolvePaletteChoice({
  location = globalThis.location,
  storage,
} = {}) {
  const queried = fromQuery(location);
  if (queried) return queried;
  const stored =
    storage === undefined
      ? readStored(globalThis.localStorage)
      : readStored(storage);
  if (stored) return stored;
  return { primary: DEFAULT_PRESET.primary, mode: DEFAULT_PRESET.mode };
}
