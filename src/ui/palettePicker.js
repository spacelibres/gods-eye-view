/**
 * Palette picker: the six identity presets plus a custom primary colour.
 *
 * The identity manual treats colour as a setting, not a constant — its own
 * site offers the same six presets and a colour field — so this control is the
 * in-app equivalent. Choosing a preset or entering a colour re-derives every
 * role through `colorSystem.js`, and the page, the symbol and the imagery
 * shading follow together.
 *
 * The list is a plain radio group: one tab stop, arrow keys move, Enter or
 * Space chooses. A native colour input covers anything outside the presets.
 */

import { t } from '../i18n/index.js';
import { COLOR_PRESETS, isValidPrimary, normalizeHex } from './colorSystem.js';

const PRESET_LABELS = Object.freeze({
  'electric-orbit': 'Electric orbit',
  'aurora-jump': 'Aurora jump',
  'nebula-spectrum': 'Nebula spectrum',
  'solar-storm': 'Solar storm',
  'deep-space-oasis': 'Deep-space oasis',
  'acid-future': 'Acid future',
});

/** The preset whose primary matches `primary`, if any. */
export function presetFor(primary) {
  const hex = normalizeHex(primary);
  if (!hex) return null;
  return COLOR_PRESETS.find((preset) => preset.primary === hex) ?? null;
}

/**
 * Mount the palette picker into `root`, which the shell provides.
 *
 * @param {HTMLElement} root
 * @param {{primary: string, onSelect: (primary: string) => void}} options
 */
export function mountPalettePicker({ root, primary, onSelect }) {
  const documentRef = root.ownerDocument;
  const active = presetFor(primary);

  root.innerHTML = `
    <div class="palette-swatches" role="radiogroup" aria-label="${t('Globe colour scheme')}">
      ${COLOR_PRESETS.map(
        (preset, index) => `
        <button
          type="button"
          role="radio"
          class="palette-swatch${preset.primary === active?.primary ? ' is-active' : ''}"
          data-primary="${preset.primary}"
          aria-checked="${preset.primary === active?.primary ? 'true' : 'false'}"
          tabindex="${preset.primary === active?.primary || (!active && index === 0) ? '0' : '-1'}"
          title="${t(PRESET_LABELS[preset.id])}"
          aria-label="${t(PRESET_LABELS[preset.id])}"
          style="--swatch: ${preset.primary}"
        ></button>`,
      ).join('')}
      <label class="palette-custom" title="${t('Custom colour')}">
        <span aria-hidden="true">+</span>
        <input
          type="color"
          value="${normalizeHex(primary) ?? COLOR_PRESETS[0].primary}"
          aria-label="${t('Custom colour')}"
        />
      </label>
    </div>`;

  const swatches = [...root.querySelectorAll('.palette-swatch')];
  const custom = root.querySelector('input[type="color"]');

  const choose = (value) => {
    if (!isValidPrimary(value)) return;
    for (const swatch of swatches) {
      const selected = swatch.dataset.primary === normalizeHex(value);
      swatch.classList.toggle('is-active', selected);
      swatch.setAttribute('aria-checked', selected ? 'true' : 'false');
      swatch.tabIndex = selected ? 0 : -1;
    }
    onSelect(normalizeHex(value));
  };

  root.addEventListener('click', (event) => {
    const swatch = event.target.closest?.('.palette-swatch');
    if (swatch) choose(swatch.dataset.primary);
  });

  // A radio group moves with the arrow keys and chooses on Space or Enter.
  root.addEventListener('keydown', (event) => {
    const index = swatches.indexOf(documentRef.activeElement);
    if (index < 0) return;
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step) {
      event.preventDefault();
      const next = (index + step + swatches.length) % swatches.length;
      swatches[next].focus();
      choose(swatches[next].dataset.primary);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(swatches[index].dataset.primary);
    }
  });

  custom?.addEventListener('input', () => choose(custom.value));

  return { choose };
}
