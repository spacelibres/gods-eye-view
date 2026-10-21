import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * After a live language switch the picker's `current` argument is stale: it
 * describes the language the page loaded with, not the one on screen. Comparing
 * a click against it made returning to that original language a silent no-op —
 * the second switch in a session simply did nothing.
 */

const source = readFileSync(
  new URL('./localePicker.js', import.meta.url),
  'utf8',
);

test('selection compares against the live locale, not the mount argument', () => {
  assert.match(
    source,
    /let currentLocale = current;/,
    'the mount argument must be tracked in a mutable variable',
  );
  assert.match(
    source,
    /if \(localeCode !== currentLocale\) onSelect\(localeCode\);/,
    'choosing must compare against the live value',
  );
  assert.doesNotMatch(
    source,
    /if \(localeCode !== current\) onSelect\(localeCode\);/,
    'the stale argument must not decide whether a switch happens',
  );
});

test('setCurrent updates what later clicks compare against', () => {
  const body = source.slice(source.indexOf('setCurrent(locale)'));
  assert.match(
    body.slice(0, 400),
    /currentLocale = locale;/,
    'a switch made elsewhere must update the picker\u2019s own idea of current',
  );
});
