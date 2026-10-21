import test from 'node:test';
import assert from 'node:assert/strict';
import {
  t,
  tn,
  setLocale,
  retranslateRenderedText,
  createLiveDocumentTranslations,
  applyDocumentTranslations,
} from './index.js';

test('rendered dynamic messages and plurals follow every locale and return to English', () => {
  setLocale('en');
  const text = t('Saved to {store}', { store: 'User vault' });
  const plural = tn(3, '{count} camera', '{count} cameras');
  for (const locale of ['zh-CN', 'ja', 'ko', 'ru', 'es', 'zh-TW', 'en']) {
    setLocale(locale);
    assert.equal(
      retranslateRenderedText(text),
      t('Saved to {store}', { store: 'User vault' }),
    );
    assert.equal(
      retranslateRenderedText(plural),
      tn(3, '{count} camera', '{count} cameras'),
    );
  }
});
function fixture(text = 'Airports') {
  const attrs = new Map([['title', t('Change the interface language')]]);
  const node = { nodeType: 3, nodeValue: text, parentElement: null };
  const el = {
    nodeType: 1,
    childNodes: [node],
    hasAttribute: (n) => attrs.has(n),
    getAttribute: (n) => attrs.get(n) ?? null,
    setAttribute: (n, v) => attrs.set(n, v),
    closest: () => null,
    querySelectorAll: () => [],
  };
  node.parentElement = el;
  const doc = {
    nodeType: 9,
    documentElement: el,
    querySelectorAll: () => [el],
  };
  return { node, el, doc, attrs };
}
test('runtime UI text and attributes retranslate in place without replacing children', () => {
  setLocale('en');
  const f = fixture(t('Airports'));
  const binding = createLiveDocumentTranslations(f.doc);
  setLocale('ja');
  binding.refresh();
  assert.equal(f.node.nodeValue, t('Airports'));
  assert.equal(f.attrs.get('title'), t('Change the interface language'));
  setLocale('en');
  binding.refresh();
  assert.equal(f.node.nodeValue, 'Airports');
  assert.equal(f.el.childNodes[0], f.node);
  binding.destroy();
});
test('runtime-owned markup retains current data instead of its boot placeholder', () => {
  const attrs = new Map([['data-i18n', '']]);
  const el = {
    textContent: 'Airports',
    getAttribute: (n) => attrs.get(n) ?? null,
    setAttribute: (n, v) => attrs.set(n, v),
  };
  const doc = {
    querySelectorAll: (selector) => (selector === '[data-i18n]' ? [el] : []),
  };
  setLocale('en');
  applyDocumentTranslations(doc);
  el.textContent = t('Saved to {store}', { store: 'Tokyo' });
  setLocale('ja');
  applyDocumentTranslations(doc);
  assert.equal(el.textContent, t('Saved to {store}', { store: 'Tokyo' }));
  setLocale('en');
});

test('runtime changes replace stale bindings and raw values are preserved', () => {
  setLocale('en');
  const f = fixture(t('Airports'));
  const binding = createLiveDocumentTranslations(f.doc);
  f.node.nodeValue = t('Saved to {store}', { store: 'Private draft' });
  binding.capture();
  setLocale('ru');
  binding.refresh();
  assert.equal(
    f.node.nodeValue,
    t('Saved to {store}', { store: 'Private draft' }),
  );
  f.node.nodeValue = 'Untranslated provider name';
  setLocale('ja');
  binding.refresh();
  assert.equal(f.node.nodeValue, 'Untranslated provider name');
  binding.destroy();
  setLocale('en');
});

test('observer translates lazy UI and disconnects without modifying excluded content', () => {
  setLocale('en');
  const f = fixture(t('Airports'));
  let receive;
  let disconnected = false;
  class Observer {
    constructor(callback) {
      receive = callback;
    }
    observe() {}
    disconnect() {
      disconnected = true;
    }
  }
  const binding = createLiveDocumentTranslations(f.doc, { Observer });
  const lazy = fixture(t('Airports'));
  setLocale('ko');
  receive([{ type: 'childList', addedNodes: [lazy.el] }]);
  assert.equal(lazy.node.nodeValue, t('Airports'));
  lazy.el.closest = () => lazy.el;
  setLocale('ru');
  receive([{ type: 'characterData', target: lazy.node }]);
  assert.notEqual(lazy.node.nodeValue, t('Airports'));
  binding.destroy();
  assert.equal(disconnected, true);
  setLocale('en');
});

test('identical rendered words keep explicit message contexts independent', () => {
  setLocale('en');
  const weather = fixture(t('CLEAR'));
  const action = fixture(t('CLEAR', { context: 'action' }));
  weather.attrs.set('data-i18n-source', 'CLEAR');
  action.attrs.set('data-i18n-source', 'CLEAR');
  action.attrs.set('data-i18n-context', 'action');
  const a = createLiveDocumentTranslations(weather.doc);
  const b = createLiveDocumentTranslations(action.doc);
  setLocale('ja');
  a.refresh();
  b.refresh();
  assert.equal(weather.node.nodeValue, t('CLEAR'));
  assert.equal(action.node.nodeValue, t('CLEAR', { context: 'action' }));
  assert.notEqual(weather.node.nodeValue, action.node.nodeValue);
  a.destroy();
  b.destroy();
  setLocale('en');
});
