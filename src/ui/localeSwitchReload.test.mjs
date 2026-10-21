// The language picker changes the words, not the session. It used to reload
// the page — losing the camera, the open panels and every live layer — and ask
// first when that would lose work. It now applies the chosen locale in place.
// Choosing the language already active still does nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StyleManager } from './applicationShell.js';
import { getLocale, setLocale } from '../i18n/index.js';

/** Wire the shell's language choice. No picker markup here: the picker's own
 * behaviour is covered by localePicker.test. */
function renderSwitch() {
  const previous = {
    document: globalThis.document,
    location: globalThis.location,
    confirm: globalThis.confirm,
  };
  const reloads = [];
  const prompts = [];
  const applied = [];
  globalThis.document = {
    documentElement: { lang: '', dir: '' },
    getElementById: () => null,
    querySelectorAll: () => [],
  };
  globalThis.location = {
    href: 'https://gev.example/#v=2',
    assign() {},
    reload: () => reloads.push(true),
  };
  globalThis.confirm = (text) => {
    prompts.push(text);
    return true;
  };
  const shell = {
    services: {},
    _confirmLocaleReload: StyleManager.prototype._confirmLocaleReload,
    _chooseLocale: StyleManager.prototype._chooseLocale,
    _applyLocaleInPlace(locale) {
      applied.push(locale);
      StyleManager.prototype._applyLocaleInPlace.call(this, locale);
    },
    _localeRepainters: () => [],
    _localePicker: null,
  };
  StyleManager.prototype._initLocaleSelector.call(shell);
  return {
    shell,
    choose: (locale) => shell._chooseLocale(locale),
    reloads,
    prompts,
    applied,
    restore() {
      Object.assign(globalThis, previous);
    },
  };
}

const storage = globalThis.localStorage;
test.before(() => {
  globalThis.localStorage = { setItem() {}, getItem: () => null };
});
test.after(() => {
  globalThis.localStorage = storage;
  setLocale('en');
});

test('choosing a language never reloads the page', () => {
  const view = renderSwitch();
  try {
    view.choose('es');
    assert.equal(view.reloads.length, 0, 'the session must survive a switch');
    assert.deepEqual(view.applied, ['es']);
    assert.equal(getLocale(), 'es');
  } finally {
    view.restore();
  }
});

test('a switch asks nothing, even with work on screen', () => {
  const view = renderSwitch();
  try {
    view.choose('ru');
    assert.deepEqual(view.prompts, []);
    assert.equal(getLocale(), 'ru');
  } finally {
    view.restore();
  }
});

test('the document language follows the choice', () => {
  const view = renderSwitch();
  try {
    view.choose('ja');
    assert.equal(globalThis.document.documentElement.lang, 'ja');
  } finally {
    view.restore();
  }
});

test('the language already active neither switches nor reloads', () => {
  setLocale('en');
  const view = renderSwitch();
  try {
    assert.equal(view.choose('en'), 'unchanged');
    assert.deepEqual(view.prompts, []);
    assert.equal(view.reloads.length, 0);
    assert.deepEqual(view.applied, []);
  } finally {
    view.restore();
  }
});

test('locale owners registered after boot are invoked and can unsubscribe', () => {
  let calls = 0;
  const shell = { services: {} };
  const stop = StyleManager.prototype.registerLocaleRepaint.call(
    shell,
    () => calls++,
  );
  for (const repaint of StyleManager.prototype._localeRepainters.call(shell))
    repaint();
  assert.equal(calls, 1);
  stop();
  for (const repaint of StyleManager.prototype._localeRepainters.call(shell))
    repaint();
  assert.equal(calls, 1);
});
