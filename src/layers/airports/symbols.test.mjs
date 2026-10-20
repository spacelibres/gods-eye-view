import test from 'node:test';
import assert from 'node:assert/strict';
import { airportSymbol, airportLegendImage } from './symbols.js';

test('heliports always use a helicopter, including military and joint-use facilities', () => {
  for (const usage of ['civil', 'military', 'joint', 'unknown']) {
    const symbol = airportSymbol({ type: 'heliport' }, usage);
    assert.equal(symbol.facility, 'helicopter');
    assert.notEqual(
      symbol.image,
      airportSymbol({ type: 'medium_airport' }, usage).image,
    );
  }
  assert.notEqual(
    airportSymbol({ type: 'heliport' }, 'military').image,
    airportSymbol({ type: 'heliport' }, 'joint').image,
  );
});
test('civil, military, joint-use and unconfirmed airfields have different silhouettes', () => {
  const symbols = ['civil', 'military', 'joint', 'unknown'].map((usage) =>
    airportSymbol({ type: 'large_airport' }, usage),
  );
  assert.equal(new Set(symbols.map((s) => s.image)).size, 4);
  assert.match(symbols[0].label, /Civil/);
  assert.match(symbols[1].label, /Military/);
  assert.match(symbols[2].label, /Joint/);
  assert.match(symbols[3].label, /unconfirmed/i);
});
test('seaplanes and balloons keep physical facility symbols, SVGs are cached and outlined', () => {
  for (const type of [
    'heliport',
    'seaplane_base',
    'balloonport',
    'small_airport',
  ]) {
    const a = airportSymbol({ type }, 'unknown'),
      b = airportSymbol({ type }, 'unknown');
    assert.equal(a, b);
    const svg = decodeURIComponent(a.image);
    assert.match(svg, /viewBox="0 0 40 40"/);
    assert.match(svg, /stroke="black"/);
    assert.match(svg, /fill="white"/);
    assert.doesNotMatch(svg, /<script|https?:\/\/(?!www\.w3\.org)/);
  }
  assert.notEqual(
    airportSymbol({ type: 'seaplane_base' }).image,
    airportSymbol({ type: 'balloonport' }).image,
  );
});

test('rotors, skids and water lines retain a light inner stroke on dark imagery and follow legend tint', () => {
  for (const type of ['heliport', 'seaplane_base', 'balloonport']) {
    const symbol = airportSymbol({ type });
    assert.match(decodeURIComponent(symbol.image), /stroke="white"/);
    const legend = decodeURIComponent(airportLegendImage(symbol, '#33b8ff'));
    assert.match(legend, /stroke="#33b8ff"/);
    assert.doesNotMatch(legend, /stroke="white"/);
  }
});
