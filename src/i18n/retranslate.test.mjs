import assert from 'node:assert/strict';
import test from 'node:test';
import { setLocale, applyDocumentTranslations } from './index.js';

/**
 * The page must be re-translatable. The first pass reads English out of the
 * markup; every later pass has to start from that same English, because by
 * then the element holds the language it was switched to.
 */

function fakeDocument(entries) {
  const elements = entries.map(({ marker, text, attribute }) => {
    const attrs = new Map();
    if (attribute) attrs.set(attribute, text);
    return {
      textContent: attribute ? '' : text,
      getAttribute(name) {
        return attrs.has(name) ? attrs.get(name) : null;
      },
      setAttribute(name, value) {
        attrs.set(name, value);
      },
      hasMarker(m) {
        return m === marker;
      },
    };
  });
  return {
    querySelectorAll(selector) {
      const marker = selector.slice(1, -1);
      return elements.filter((element) => element.hasMarker(marker));
    },
  };
}

test('the same element translates again after an intermediate language', () => {
  const doc = fakeDocument([{ marker: 'data-i18n', text: 'Airports' }]);
  const el = doc.querySelectorAll('[data-i18n]')[0];

  setLocale('zh-CN');
  applyDocumentTranslations(doc);
  assert.equal(el.textContent, '机场');

  setLocale('ja');
  applyDocumentTranslations(doc);
  assert.equal(
    el.textContent,
    '空港',
    'the second switch must start from the English source, not the Chinese text',
  );

  setLocale('ko');
  applyDocumentTranslations(doc);
  assert.notEqual(el.textContent, '空港');

  setLocale('en');
  applyDocumentTranslations(doc);
  assert.equal(el.textContent, 'Airports', 'English is reachable again');
});

test('attributes are re-translated too', () => {
  const doc = fakeDocument([
    { marker: 'data-i18n-title', text: 'Airports', attribute: 'title' },
  ]);
  const el = doc.querySelectorAll('[data-i18n-title]')[0];

  setLocale('zh-CN');
  applyDocumentTranslations(doc);
  assert.equal(el.getAttribute('title'), '机场');

  setLocale('ja');
  applyDocumentTranslations(doc);
  assert.equal(el.getAttribute('title'), '空港');
});

test('the English source is remembered on the element', () => {
  const doc = fakeDocument([{ marker: 'data-i18n', text: 'Airports' }]);
  const el = doc.querySelectorAll('[data-i18n]')[0];
  setLocale('zh-CN');
  applyDocumentTranslations(doc);
  assert.equal(el.getAttribute('data-i18n-key'), 'Airports');
});

test('a switch back to the starting language is not a silent no-op', () => {
  const doc = fakeDocument([{ marker: 'data-i18n', text: 'Airports' }]);
  const el = doc.querySelectorAll('[data-i18n]')[0];
  setLocale('en');
  applyDocumentTranslations(doc);

  for (const locale of ['ja', 'zh-CN', 'en']) {
    setLocale(locale);
    applyDocumentTranslations(doc);
    if (locale === 'en') assert.equal(el.textContent, 'Airports');
    if (locale === 'ja') assert.equal(el.textContent, '空港');
    if (locale === 'zh-CN') assert.equal(el.textContent, '机场');
  }
});
