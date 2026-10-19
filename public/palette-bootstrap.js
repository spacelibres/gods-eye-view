/**
 * Paint the palette before the first frame.
 *
 * `index.html` loads this with a plain blocking `<script src>` in `<head>`,
 * before the stylesheets, so the loading screen is already in the visitor's
 * palette instead of flashing the default and correcting itself a moment
 * later. It is deliberately not a module: module scripts are deferred, which
 * is too late for the first paint. (The CSP forbids inline scripts, hence a
 * file rather than an inlined block.)
 *
 * The maths below is a direct port of `src/ui/colorSystem.js`, the choice is a
 * port of `src/ui/paletteChoice.js`, and the variable names are
 * `src/ui/colorSystemRuntime.js`'s. `src/palette-bootstrap.test.mjs` runs this
 * file against those modules and fails on any drift, so the copy cannot rot.
 *
 * Keep it small — it is on the critical path of the very first paint.
 */
(() => {
  const PRESETS = [
    { primary: '#007BFF', mode: 'split' },
    { primary: '#12D6B0', mode: 'triad' },
    { primary: '#A15AFF', mode: 'analogous' },
    { primary: '#FF6A3D', mode: 'split' },
    { primary: '#15BDAD', mode: 'split' },
    { primary: '#CBEA35', mode: 'triad' },
  ];
  const MODES = ['auto', 'split', 'triad', 'analogous'];
  const STORAGE_KEY = 'gev:palette:v1';

  function normalizeHex(value) {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(value ?? '').trim());
    return match ? `#${match[1].toUpperCase()}` : null;
  }

  function hexToHsl(hex) {
    const [r, g, b] = hex
      .match(/[a-f\d]{2}/gi)
      .map((x) => parseInt(x, 16) / 255);
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
      .join('')}`.toUpperCase();
  }

  function mixHex(a, b, weight) {
    const parse = (hex) =>
      hex.match(/[a-f\d]{2}/gi).map((x) => parseInt(x, 16));
    const [ar, ag, ab] = parse(a);
    const [br, bg, bb] = parse(b);
    const mix = (x, y) => Math.round(x * (1 - weight) + y * weight);
    return `#${[mix(ar, br), mix(ag, bg), mix(ab, bb)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')}`.toUpperCase();
  }

  function luminance(hex) {
    const [r, g, b] = hex
      .match(/[a-f\d]{2}/gi)
      .map((x) => parseInt(x, 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrast(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  function fitContrast(hex, background, min, direction) {
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

  function resolveMode(hue, saturation, lightness, mode) {
    if (mode !== 'auto') return mode;
    if (saturation < 12) return 'analogous';
    if (lightness > 68) return 'split';
    if (hue >= 180 && hue <= 285) return 'triad';
    if (hue < 65 || hue > 325) return 'split';
    return 'analogous';
  }

  function generatePalette(primary, mode = 'auto') {
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
      4.5,
      'dark',
    );
    palette.line = mixHex(palette.ink, palette.surface, 0.18);
    palette.success = fitContrast(
      hslToHex(150 + (hue % 18), 65, 38),
      palette.surface,
      5.5,
      'dark',
    );
    palette.warning = fitContrast(
      hslToHex(38 + (hue % 10), 85, 42),
      palette.surface,
      5.5,
      'dark',
    );
    palette.danger = fitContrast(
      hslToHex(350 + (hue % 15), 75, 45),
      palette.surface,
      5.5,
      'dark',
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

  function paletteToCssVars(palette) {
    const vars = {};
    for (const [key, value] of Object.entries(palette)) {
      vars[`--sp-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`] =
        value;
    }
    return vars;
  }

  function resolveChoice() {
    try {
      const params = new URLSearchParams(globalThis.location.search);
      const primary = normalizeHex(params.get('primary'));
      if (primary) {
        const mode = params.get('mode');
        return { primary, mode: MODES.includes(mode) ? mode : 'auto' };
      }
    } catch {
      // No usable location: fall through to the stored choice.
    }
    try {
      const parsed = JSON.parse(
        globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null',
      );
      const primary = normalizeHex(parsed?.primary);
      if (primary) {
        return {
          primary,
          mode: MODES.includes(parsed?.mode) ? parsed.mode : 'auto',
        };
      }
    } catch {
      // Storage can be blocked; the default preset still applies.
    }
    return { primary: PRESETS[0].primary, mode: PRESETS[0].mode };
  }

  /** Resolve, derive and write the roles onto <html> before the first paint. */
  function applyPaletteEarly() {
    const choice = resolveChoice();
    const palette = generatePalette(choice.primary, choice.mode);
    const root = document.documentElement;
    for (const [name, value] of Object.entries(paletteToCssVars(palette))) {
      root.style.setProperty(name, value);
    }
    // The inlined lockup reads these two directly.
    root.style.setProperty('--sp-logo-primary', palette.primaryOnDark);
    root.style.setProperty('--sp-logo-planet', palette.planetOnDark);
    // A stable hook for stylesheets and for the runtime that adopts this state.
    root.dataset.palette = choice.mode;
    // The browser chrome should match the page it is showing.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', palette.deep);
    return palette;
  }

  Object.assign(globalThis, {
    __gevPalette: { applyPaletteEarly, generatePalette, resolveChoice },
  });
  applyPaletteEarly();
})();
