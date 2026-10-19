import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { getCatalog, setLocale, t } from './index.js';

afterEach(() => setLocale('en'));

test('getCatalog returns a Map-backed lookup that answers like the catalog', () => {
  const catalog = getCatalog('es');
  assert.ok(catalog instanceof Map);
  setLocale('es');
  assert.equal(catalog.get('LOAD COMPLETE'), t('LOAD COMPLETE'));
});

test('switching locale switches the catalog without leaking entries', () => {
  setLocale('es');
  const spanish = t('LOAD COMPLETE');
  setLocale('ru');
  assert.notEqual(t('LOAD COMPLETE'), spanish);
  assert.equal(t('LOAD COMPLETE'), getCatalog('ru').get('LOAD COMPLETE'));
});

test('an unknown locale falls back to English', () => {
  setLocale('xx-YY');
  assert.equal(getCatalog('xx-YY'), null);
  assert.equal(t('Save keys'), 'Save keys');
});

test('prototype keys never answer as messages', () => {
  setLocale('es');
  assert.equal(t('constructor'), 'constructor');
  assert.equal(t('__proto__'), '__proto__');
});
