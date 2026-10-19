/**
 * The spacelibre palette system, ported from vi.spacelibre.cn.
 *
 * The identity manual does not fix one colour. It fixes a primary colour and a
 * harmony rule, then derives every other role from them. Six presets ship; any
 * primary can be entered instead. Roles are named so the same tokens drive the
 * page, the symbol and the imagery shade, which is what keeps the site and the
 * manual in step.
 *
 * The derivation is a direct port of the manual's own script: the same HSL
 * maths, the same harmony offsets, the same WCAG contrast fitting. Changing it
 * here and there independently would let the two drift apart.
 */

/** The six presets, in the manual's order, with their harmony rule. */
export const COLOR_PRESETS = Object.freeze([
  { id: 'electric-orbit', primary: '#007BFF', mode: 'split' },
  { id: 'aurora-jump', primary: '#12D6B0', mode: 'triad' },
  { id: 'nebula-spectrum', primary: '#A15AFF', mode: 'analogous' },
  { id: 'solar-storm', primary: '#FF6A3D', mode: 'split' },
  { id: 'deep-space-oasis', primary: '#15BDAD', mode: 'split' },
  { id: 'acid-future', primary: '#CBEA35', mode: 'triad' },
]);

/** Harmony rules the manual offers beside its presets. */
export const COLOR_MODES = Object.freeze([
  'auto',
  'split',
  'triad',
  'analogous',
]);

function hexToHsl(hex) {
  const [r, g, b] = hex.match(/[a-f\d]{2}/gi).map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [(h + 360) % 360, s * 100, l * 100];
}

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const rgb =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return `#${rgb
    .map((v) =>
      Math.round((v + m) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`;
}

function mixHex(a, b, weight) {
  const parse = (hex) => hex.match(/[a-f\d]{2}/gi).map((x) => parseInt(x, 16));
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const mix = (x, y) => Math.round(x * (1 - weight) + y * weight);
  return `#${[mix(ar, br), mix(ag, bg), mix(ab, bb)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

function luminance(hex) {
  const [r, g, b] = hex
    .match(/[a-f\d]{2}/gi)
    .map((x) => parseInt(x, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours. */
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Move `hex` toward black or white until it clears `min` against `background`,
 * so a derived role stays readable whatever primary the user picks.
 */
function fitContrast(hex, background, min = 4.5, direction = 'dark') {
  if (contrast(hex, background) >= min) return hex.toUpperCase();
  const [h, s, l] = hexToHsl(hex);
  for (let step = 1; step <= 100; step += 1) {
    const next =
      direction === 'dark' ? Math.max(0, l - step) : Math.min(100, l + step);
    const candidate = hslToHex(h, s, next);
    if (contrast(candidate, background) >= min) return candidate;
  }
  return direction === 'dark' ? '#000000' : '#FFFFFF';
}

/** Resolve `auto` to a concrete harmony rule from the primary's own hue. */
function resolveMode(hue, saturation, lightness, mode) {
  if (mode !== 'auto') return mode;
  if (saturation < 12) return 'analogous';
  if (lightness > 68) return 'split';
  if (hue >= 180 && hue <= 285) return 'triad';
  if (hue < 65 || hue > 325) return 'split';
  return 'analogous';
}

/**
 * Derive the full role palette from one primary colour.
 *
 * @param {string} primary Six-digit hex, with or without `#`.
 * @param {string} [mode] One of `COLOR_MODES`; `auto` picks by hue.
 * @returns {Record<string, string>} The sixteen roles the manual names.
 */
export function generatePalette(primary, mode = 'auto') {
  const hex = normalizeHex(primary);
  const [originalHue, saturation, lightness] = hexToHsl(hex);
  const hue = saturation < 12 ? 215 : originalHue;
  const resolved = resolveMode(hue, saturation, lightness, mode);
  const offsets =
    resolved === 'triad'
      ? [120, 240]
      : resolved === 'analogous'
        ? [35, -35]
        : [150, 210];

  const palette = {
    primary: hex,
    secondary: hslToHex(hue + offsets[0], Math.max(saturation, 78), 60),
    accent: hslToHex(hue + offsets[1], 90, 68),
    deep: hslToHex(hue, 44, 9),
    surface: hslToHex(hue, 40, 96),
    ink: hslToHex(hue, 58, 17),
  };
  palette.card = mixHex(palette.surface, '#FFFFFF', 0.2);
  palette.muted = fitContrast(
    mixHex(palette.ink, palette.surface, 0.6),
    palette.surface,
  );
  palette.line = mixHex(palette.ink, palette.surface, 0.18);
  palette.success = fitContrast(
    hslToHex(150 + (hue % 18), 65, 38),
    palette.surface,
    5.5,
  );
  palette.warning = fitContrast(
    hslToHex(38 + (hue % 10), 85, 42),
    palette.surface,
    5.5,
  );
  palette.danger = fitContrast(
    hslToHex(350 + (hue % 15), 75, 45),
    palette.surface,
    5.5,
  );
  palette.primaryOnLight = fitContrast(
    palette.primary,
    palette.surface,
    4.5,
    'dark',
  );
  palette.primaryOnDark = fitContrast(
    palette.primary,
    palette.deep,
    4.5,
    'light',
  );
  palette.planetOnLight = fitContrast(
    palette.secondary,
    palette.surface,
    4.5,
    'dark',
  );
  palette.planetOnDark = fitContrast(
    palette.secondary,
    palette.deep,
    4.5,
    'light',
  );
  return palette;
}

/** Accept `#abc123`, `abc123`, and upper-case input alike. */
export function normalizeHex(value) {
  const text = String(value ?? '').trim();
  const match = /^#?([0-9a-f]{6})$/i.exec(text);
  return match ? `#${match[1].toUpperCase()}` : null;
}

/** True when `value` is a usable primary colour. */
export function isValidPrimary(value) {
  return normalizeHex(value) !== null;
}

/**
 * The CSS custom properties for one palette, as the manual emits them:
 * camelCase roles become kebab-case tokens (`primaryOnDark` → `--primary-on-dark`).
 */
export function paletteToCssVars(palette) {
  const roles = {};
  for (const [key, value] of Object.entries(palette)) {
    roles[`--sp-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`] =
      value;
  }
  return roles;
}
