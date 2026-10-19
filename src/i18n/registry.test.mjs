import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LOCALE_REGISTRY } from './registry.js';
import {
  LOCALES,
  LOCALE_NAMES,
  RTL_LOCALES,
  normalizeLocale,
} from './locale.js';

test('the registry is the source of the locale exports', () => {
  assert.deepEqual(
    LOCALES,
    LOCALE_REGISTRY.map((locale) => locale.code),
  );
  for (const { code, name } of LOCALE_REGISTRY) {
    assert.equal(LOCALE_NAMES[code], name);
  }
  assert.deepEqual(
    RTL_LOCALES,
    LOCALE_REGISTRY.filter((locale) => locale.dir === 'rtl').map((l) => l.code),
  );
});

test('every locale code is unique and lower-case except a region subtag', () => {
  const codes = LOCALE_REGISTRY.map((locale) => locale.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const code of codes) {
    assert.match(code, /^[a-z]{2}(-[A-Z]{2})?$/);
  }
});

test('normalizeLocale matches exact region tags before bare codes', () => {
  assert.equal(normalizeLocale('zh-CN'), 'zh-CN');
  assert.equal(normalizeLocale('zh-cn'), 'zh-CN');
  if (LOCALES.includes('zh-TW')) {
    assert.equal(normalizeLocale('zh-TW'), 'zh-TW');
    assert.equal(normalizeLocale('zh-tw'), 'zh-TW');
  }
  if (LOCALES.includes('pt-BR')) {
    assert.equal(normalizeLocale('pt-br'), 'pt-BR');
    assert.equal(normalizeLocale('pt'), 'pt-BR');
  }
  assert.equal(normalizeLocale('zh'), 'zh-CN');
});

test('normalizeLocale falls back to the first locale of the same language', () => {
  if (LOCALES.includes('zh-TW')) assert.equal(normalizeLocale('zh-HK'), 'zh-TW');
  if (LOCALES.includes('pt-BR')) assert.equal(normalizeLocale('pt-PT'), 'pt-BR');
  assert.equal(normalizeLocale('en-AU'), 'en');
  assert.equal(normalizeLocale('ru-RU'), 'ru');
  if (LOCALES.includes('de')) assert.equal(normalizeLocale('de-AT'), 'de');
  assert.equal(normalizeLocale('xx-YY'), null);
});
