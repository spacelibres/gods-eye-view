import test from 'node:test';
import assert from 'node:assert/strict';
import { createAirportGeocoder } from './airports.js';
import { createDefaultPlaceSearch } from './defaults.js';
const a = {
  id: '1',
  ident: 'EGLL',
  icaoCode: 'EGLL',
  iataCode: 'LHR',
  name: 'London Heathrow Airport',
  lat: 51.47,
  lon: -0.46,
  municipality: 'London',
  country: 'United Kingdom',
};
test('codes and full airport names resolve precisely, ordinary city words decline', async () => {
  const queries = [];
  const provider = createAirportGeocoder({
    source: {
      search: async (q) => {
        queries.push(q);
        return { airports: [a], truncated: false };
      },
    },
  });
  for (const q of ['EGLL', 'LHR', 'London Heathrow Airport']) {
    const result = await provider.geocode(q);
    assert.equal(result.place.exact, true);
    assert.deepEqual(result.place.types, ['airport']);
  }
  for (const q of ['lhr', 'can', 'London', 'Hanoi'])
    assert.equal((await provider.geocode(q)).place, null);
  assert.equal(queries.length, 3);
});
test('duplicate codes and truncated identities are choices, never first-match', async () => {
  const provider = createAirportGeocoder({
    source: {
      search: async () => ({
        airports: [a, { ...a, id: '2', name: 'Other Airport' }],
        truncated: false,
      }),
    },
  });
  const result = await provider.geocode('LHR');
  assert.equal(result.place, null);
  assert.equal(result.terminal, true);
  assert.equal(result.choices.length, 2);
});
test('airport errors stop default fallbacks while ordinary queries and injected providers work', async () => {
  const urls = [];
  const service = createDefaultPlaceSearch({
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.startsWith('/api/airports'))
        return new Response('', { status: 503 });
      return Response.json({ features: [] });
    },
  });
  assert.equal((await service.geocode('EGLL')).answered, false);
  assert.equal(urls.length, 1);
  await service.geocode('Hanoi');
  assert.ok(urls.some((url) => url.includes('photon')));
  const injected = createDefaultPlaceSearch({
    providers: {
      geocode: [
        {
          geocode: async () => ({ place: { name: 'custom' }, answered: true }),
        },
      ],
    },
    fetchImpl: () => {
      throw Error('must not fetch');
    },
  });
  assert.equal((await injected.geocode('LHR')).place.name, 'custom');
});
test('ambiguity survives composition and case-sensitive code intent cannot poison lowercase cache', async () => {
  const provider = createAirportGeocoder({
    source: {
      search: async () => ({
        airports: [a, { ...a, id: '2' }],
        truncated: false,
      }),
    },
  });
  const { createPlaceSearch } = await import('./placeSearch.js');
  const search = createPlaceSearch({
    providers: [
      provider,
      { geocode: async () => ({ place: { name: 'city' }, answered: true }) },
    ],
  });
  assert.equal((await search.geocode('LHR')).choices.length, 2);
  assert.equal((await search.geocode('lhr')).place.name, 'city');
});

test('uppercase city names without exact airport codes keep generic search', async () => {
  const { createPlaceSearch } = await import('./placeSearch.js');
  const provider = createAirportGeocoder({
    source: { search: async () => ({ airports: [a], truncated: false }) },
  });
  for (const query of ['ROME', 'OSLO']) {
    const search = createPlaceSearch({
      providers: [
        provider,
        { geocode: async () => ({ place: { name: query }, answered: true }) },
      ],
    });
    assert.equal((await search.geocode(query)).place?.name, query);
  }
});
test('multiword directory names match exactly after normalization without claiming city queries', async () => {
  const records = [
    { ...a, name: 'Dallas Love Field' },
    { ...a, id: '2', name: 'Albuquerque International Sunport' },
  ];
  const provider = createAirportGeocoder({
    source: { search: async () => ({ airports: records, truncated: false }) },
  });
  for (const query of [
    'Dallas Love Field',
    'albuquerque international sunport',
    'DALLAS  LOVE FIELD',
  ])
    assert.equal((await provider.geocode(query)).place?.exact, true);
  for (const query of [
    'New York',
    'Dallas Love',
    'Albuquerque International',
  ]) {
    const result = await provider.geocode(query);
    assert.equal(result.place, null);
    assert.equal(result.terminal, undefined);
  }
  const unavailable = createAirportGeocoder({
    source: {
      search: async () => {
        throw Error('offline');
      },
    },
  });
  assert.equal((await unavailable.geocode('New York')).terminal, undefined);
});
