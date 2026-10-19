import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { generatePalette, COLOR_PRESETS } from './ui/colorSystem.js';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SOURCE = readFileSync(
  path.join(ROOT, 'public', 'palette-bootstrap.js'),
  'utf8',
);
const INDEX = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/**
 * Run the pre-paint script the way the browser does: as a classic script, with
 * a fake document and an optional stored palette.
 */
function runBootstrap({ stored, search = '' } = {}) {
  const written = new Map();
  const meta = { content: '' };
  const store = new Map(stored ? [['gev:palette:v1', stored]] : []);
  let early = null;
  const context = {
    document: {
      documentElement: {
        dataset: {},
        style: { setProperty: (name, value) => written.set(name, value) },
      },
      querySelector: (selector) =>
        selector.includes('theme-color')
          ? {
              setAttribute: (_, value) => {
                meta.content = value;
              },
            }
          : null,
    },
    location: { search },
    localStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
    },
    URLSearchParams,
    Math,
    JSON,
    Object,
    String,
    Number,
    RegExp,
  };
  vm.runInNewContext(SOURCE, context);
  early = context.globalThis?.__gevPalette ?? context.__gevPalette;
  return { written, meta, palette: early };
}

const plain = (value) => JSON.parse(JSON.stringify(value));

test('the pre-paint copy derives the same palette as the module', () => {
  for (const preset of COLOR_PRESETS) {
    const { palette } = runBootstrap();
    assert.deepEqual(
      plain(palette.generatePalette(preset.primary, preset.mode)),
      generatePalette(preset.primary, preset.mode),
      `${preset.id} (${preset.mode})`,
    );
  }
});

test('the first frame uses the stored palette, not the default', () => {
  const choice = { primary: '#FF6A3D', mode: 'split' };
  const { written, meta, palette } = runBootstrap({
    stored: JSON.stringify(choice),
  });
  const expected = generatePalette(choice.primary, choice.mode);
  for (const [key, value] of Object.entries(expected)) {
    const token = `--sp-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
    assert.equal(written.get(token), value, token);
  }
  assert.equal(written.get('--sp-logo-primary'), expected.primaryOnDark);
  assert.equal(written.get('--sp-logo-planet'), expected.planetOnDark);
  assert.equal(meta.content, expected.deep);
  assert.deepEqual(plain(palette.resolveChoice()), choice);
});

test('a query primary wins over the stored choice', () => {
  const { written } = runBootstrap({
    stored: JSON.stringify({ primary: '#FF6A3D', mode: 'split' }),
    search: '?primary=CBEA35&mode=triad',
  });
  assert.equal(written.get('--sp-primary'), '#CBEA35');
});

test('a missing preference falls back to the default preset', () => {
  const { written } = runBootstrap();
  assert.equal(written.get('--sp-primary'), COLOR_PRESETS[0].primary);
});

test('index.html loads the script before the stylesheets', () => {
  const script = INDEX.indexOf('src="/palette-bootstrap.js"');
  const styles = INDEX.indexOf('<link rel="stylesheet" href="/style.css" />');
  assert.ok(script >= 0, 'index.html must load /palette-bootstrap.js');
  assert.ok(script < styles, 'the palette must be known before the styles');
});
