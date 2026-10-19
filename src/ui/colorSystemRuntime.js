/**
 * Applies the spacelibre palette to the document, from the identity manual's
 * own rules: one primary colour, one harmony rule, sixteen derived roles.
 *
 * The chosen preset is remembered (like the interface language) and can be
 * set per visit with `?primary=RRGGBB` and `?mode=split|triad|analogous|auto`.
 * A `prefers-color-scheme` change re-derives the roles so the page follows the
 * system, which is what the manual's "外观跟随系统" control describes.
 */

import {
  COLOR_MODES,
  generatePalette,
  isValidPrimary,
  normalizeHex,
  paletteToCssVars,
} from './colorSystem.js';
import {
  DEFAULT_PRESET,
  PALETTE_STORAGE_KEY,
  resolvePaletteChoice,
} from './paletteChoice.js';

export { DEFAULT_PRESET, PALETTE_STORAGE_KEY, resolvePaletteChoice };

let current = null;

/** The palette in force, or null before the first application. */
export function getActivePalette() {
  return current;
}

function writeStored(choice, storage) {
  try {
    const store = storage !== undefined ? storage : globalThis.localStorage;
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(PALETTE_STORAGE_KEY, JSON.stringify(choice));
    return true;
  } catch {
    return false;
  }
}

/**
 * Write one palette onto an element as CSS custom properties, and record the
 * mode on the root so stylesheets can react.
 *
 * The pre-paint script in `index.html` has already written the same variables,
 * so this replaces them rather than adding a second source of truth.
 *
 * @param {Record<string, string>} palette The generated roles.
 * @param {HTMLElement} [root] Defaults to the document element.
 * @param {string} [mode] The harmony rule, recorded for stylesheets.
 * @returns {Record<string, string>} The palette that was applied.
 */
export function applyPalette(
  palette,
  root = globalThis.document?.documentElement,
  mode,
) {
  current = palette;
  if (!root?.style?.setProperty) return palette;
  for (const [name, value] of Object.entries(paletteToCssVars(palette))) {
    root.style.setProperty(name, value);
  }
  // The symbol reads these directly, so an inline SVG and the page agree even
  // before any stylesheet resolves `var()`.
  root.style.setProperty('--sp-logo-primary', palette.primaryOnDark);
  root.style.setProperty('--sp-logo-planet', palette.planetOnDark);
  if (mode && root.dataset) root.dataset.palette = mode;
  return palette;
}

/**
 * Choose a primary colour and harmony rule, apply them, and remember the
 * choice for the next visit.
 *
 * @param {string} primary Six-digit hex.
 * @param {string} [mode] One of `COLOR_MODES`.
 * @param {object} [options] Injectable `storage` and `root` for tests.
 * @returns {Record<string, string>|null} Null when the colour is invalid.
 */
export function setPalette(primary, mode = 'auto', options = {}) {
  const hex = normalizeHex(primary);
  if (!isValidPrimary(hex)) return null;
  const resolvedMode = COLOR_MODES.includes(mode) ? mode : 'auto';
  const palette = generatePalette(hex, resolvedMode);
  applyPalette(palette, options.root, resolvedMode);
  writeStored({ primary: hex, mode: resolvedMode }, options.storage);
  return palette;
}

/**
 * Adopt the palette the pre-paint script already applied, and keep following
 * the system's light/dark preference. Call once, before the UI is built.
 */
export function initColorSystem(options = {}) {
  const choice = resolvePaletteChoice(options);
  const palette = applyPalette(
    generatePalette(choice.primary, choice.mode),
    options.root,
    choice.mode,
  );

  // The manual's interface follows the system's light/dark preference. The
  // roles already carry light and dark variants, so re-deriving is enough.
  const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  if (media?.addEventListener) {
    const follow = () =>
      applyPalette(
        generatePalette(choice.primary, choice.mode),
        options.root,
        choice.mode,
      );
    media.addEventListener('change', follow);
  }
  return { ...palette, primary: palette.primary, mode: choice.mode };
}
