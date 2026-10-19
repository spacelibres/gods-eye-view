// An empty or blank translation must not count as done.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkCatalog,
  extractMessages,
  readCatalog,
} from '../../scripts/i18n.mjs';
import { getCatalog, setLocale, t, tn, translateKnown } from './index.js';

const messages = extractMessages();
const EMPTY = 'DISCONNECT';
const BLANK = 'CONTACT LOST · LAST KNOWN READOUT · NOT AN ALL-CLEAR';

for (const locale of ['es', 'ru']) {
  test(`${locale}: checkCatalog rejects an empty or blank translation`, () => {
    const catalog = { ...readCatalog(locale), [EMPTY]: '', [BLANK]: '  ' };
    const { errors } = checkCatalog(locale, catalog, messages);
    assert.ok(
      errors.some((e) => e.includes(`"${EMPTY}"`)),
      'empty string passes the check',
    );
    assert.ok(
      errors.some((e) => e.includes(`"${BLANK}"`)),
      'blank string passes the check',
    );
  });
}

test('t() and translateKnown() fall back to English for an empty entry', () => {
  const es = getCatalog('es');
  const saved = es.get(EMPTY);
  es.set(EMPTY, '');
  setLocale('es');
  try {
    assert.equal(t(EMPTY), EMPTY);
    assert.equal(translateKnown(EMPTY), EMPTY);
  } finally {
    es.set(EMPTY, saved);
    setLocale('en');
  }
});

test('tn() skips an empty plural form', () => {
  const es = getCatalog('es');
  const KEY = '{count} INPUTS UNKNOWN';
  const saved = es.get(KEY);
  setLocale('es');
  try {
    es.set(KEY, { ...saved, one: ' ' });
    assert.equal(
      tn(1, '{count} INPUT UNKNOWN', KEY),
      saved.other.replace('{count}', '1'),
    );
    es.set(KEY, { one: '', many: '', other: '' });
    assert.equal(tn(1, '{count} INPUT UNKNOWN', KEY), '1 INPUT UNKNOWN');
    assert.equal(tn(3, '{count} INPUT UNKNOWN', KEY), '3 INPUTS UNKNOWN');
  } finally {
    es.set(KEY, saved);
    setLocale('en');
  }
});
