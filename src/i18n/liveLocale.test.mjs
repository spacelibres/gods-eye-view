import assert from 'node:assert/strict';
import test from 'node:test';
import { setLocale, getLocale, applyDocumentTranslations, t } from './index.js';
import { applyDocumentLanguage } from './locale.js';

/**
 * Changing language is a presentation change, not a restart. Reloading the page
 * throws away the camera, the open panels and every layer the visitor switched
 * on — for a change that only alters the words.
 *
 * The i18n layer already supports this: setLocale is a pure state change and
 * applyDocumentTranslations rewrites the opted-in DOM. What these tests pin is
 * that the pair is complete enough to drive a live switch.
 */

/** Minimal stand-in for the marked-up elements in the shipped templates. */
function fakeDocument(entries) {
  const elements = entries.map(({ marker, text, attribute }) => {
    const attributes = new Map();
    if (attribute) attributes.set(attribute, text);
    return {
      textContent: attribute ? '' : text,
      attributes,
      getAttribute(name) {
        return attributes.has(name) ? attributes.get(name) : null;
      },
      setAttribute(name, value) {
        attributes.set(name, value);
      },
      hasMarker(m) {
        return m === marker;
      },
    };
  });
  return {
    documentElement: { lang: '', dir: '' },
    querySelectorAll(selector) {
      const marker = selector.slice(1, -1);
      return elements.filter((element) => element.hasMarker(marker));
    },
  };
}

test('switching locale rewrites the marked-up DOM in place', () => {
  const doc = fakeDocument([
    { marker: 'data-i18n', text: 'Airports' },
    { marker: 'data-i18n-title', text: 'Airports', attribute: 'title' },
  ]);

  setLocale('en');
  applyDocumentTranslations(doc);

  setLocale('zh-CN');
  assert.equal(getLocale(), 'zh-CN');
  applyDocumentTranslations(doc);

  assert.equal(
    doc.querySelectorAll('[data-i18n]')[0].textContent,
    '机场',
    'text nodes follow the new locale',
  );
  assert.equal(
    doc.querySelectorAll('[data-i18n-title]')[0].getAttribute('title'),
    '机场',
    'attributes follow it too',
  );
});

test('the catalog answers in the switched language with no reload', () => {
  setLocale('en');
  assert.equal(t('Airports'), 'Airports');

  setLocale('ja');
  assert.equal(t('Airports'), '空港');

  setLocale('zh-CN');
  assert.equal(t('Airports'), '机场');
});

test('a live switch sets <html lang> and leaves direction alone for LTR', () => {
  const doc = fakeDocument([]);
  setLocale('ja');
  applyDocumentLanguage(doc, getLocale());
  assert.equal(doc.documentElement.lang, 'ja');
  assert.equal(doc.documentElement.dir, 'ltr');
});

test('every shipped locale can be entered and left without a load', () => {
  for (const locale of ['en', 'es', 'ru', 'zh-CN', 'zh-TW', 'ja', 'ko']) {
    setLocale(locale);
    assert.equal(getLocale(), locale);
    assert.equal(typeof t('Airports'), 'string');
  }
  setLocale('en');
});
