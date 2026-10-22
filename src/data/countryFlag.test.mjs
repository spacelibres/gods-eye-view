import test from 'node:test';
import assert from 'node:assert/strict';
import { countryFlagCode, countryFlagUrl } from './countryFlag.js';

test('countryFlagCode resolves a valid ISO code directly', () => {
  assert.equal(countryFlagCode({ countryCode: 'us' }), 'US');
  assert.equal(countryFlagCode({ countryCode: 'GB' }), 'GB');
});

test('countryFlagCode resolves a known English country name to its code', () => {
  assert.equal(countryFlagCode({ countryName: 'United States' }), 'US');
  assert.equal(countryFlagCode({ countryName: 'France' }), 'FR');
});

test('countryFlagCode resolves an exonym through the shared parser', () => {
  assert.equal(countryFlagCode({ countryName: 'Turkey' }), 'TR');
  assert.equal(countryFlagCode({ countryName: 'Holland' }), 'NL');
});

test('countryFlagCode prefers a valid code over a name', () => {
  assert.equal(
    countryFlagCode({ countryCode: 'GB', countryName: 'United States' }),
    'GB',
  );
});

test('countryFlagCode fails closed for empty, unknown, and non-ISO values', () => {
  assert.equal(countryFlagCode(), null);
  assert.equal(countryFlagCode({}), null);
  assert.equal(countryFlagCode({ countryCode: '' }), null);
  assert.equal(countryFlagCode({ countryCode: 'XX' }), null);
  assert.equal(countryFlagCode({ countryName: 'Atlantis' }), null);
});

test('countryFlagUrl maps a code to a public flag asset and fails closed', () => {
  assert.equal(countryFlagUrl({ countryCode: 'US' }), '/flags/us.svg');
  assert.equal(countryFlagUrl({ countryCode: 'gb' }), '/flags/gb.svg');
  assert.equal(countryFlagUrl({ countryName: 'United States' }), '/flags/us.svg');
  assert.equal(countryFlagUrl({ countryCode: 'XX' }), null);
  assert.equal(countryFlagUrl(), null);
});
