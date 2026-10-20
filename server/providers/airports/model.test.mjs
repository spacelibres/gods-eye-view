import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAirportCsv,
  queryAirports,
  searchAirports,
  validateSnapshot,
} from './model.js';
import { isAirportRecord } from '../../../src/sources/airports/records.js';
const header =
  'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,iso_country,iso_region,municipality,scheduled_service,icao_code,iata_code,gps_code,local_code,home_link,wikipedia_link,keywords';
const csv =
  header +
  '\n1,NA-X,small_airport,"München, Field",1,175,100,NA,NA-KA,City,yes,,DUP,GPS,L,,,alias\n2,X,large_airport,Other,2,-175,bad,NA,NA-KA,,no,TEST,DUP,,,,,\n3,Y,closed,Closed,3,0,,NA,NA-KA,,no,,,,,,,\n4,Z,small_airport,Invalid,,0,,NA,NA-KA,,no,,,,,,,';
const records = () =>
  parseAirportCsv(csv, 'code,name\nNA,Namibia', 'code,name\nNA-KA,Karas');
const snapshot = () => ({
  schemaVersion: 1,
  revision: 'a'.repeat(40),
  updatedAt: '2026-10-21T00:00:00.000Z',
  source: 'OurAirports',
  sourceUrl: 'https://ourairports.com/data/',
  records: records(),
});
test('CSV preserves Unicode, quoting, Namibia and distinct code identity', () => {
  const r = records();
  assert.equal(r.length, 3);
  assert.equal(r[0].name, 'München, Field');
  assert.equal(r[0].country, 'Namibia');
  assert.equal(r[0].icaoCode, '');
  assert.equal(r[0].ident, 'NA-X');
  assert.equal(r[0].elevationM, 30.48);
  assert.equal(r[1].elevationM, null);
  assert.ok(isAirportRecord(r[0]));
  assert.equal(isAirportRecord({ ...r[0], lat: '' }), false);
});
test('reject duplicate stable IDs and bad schema', () => {
  assert.throws(() =>
    parseAirportCsv(
      csv + '\n1,X,small_airport,Duplicate,1,1,,NA,,,,,,,,,,',
      'code,name\nNA,Namibia',
      'code,name\nNA-KA,Karas',
    ),
  );
  assert.throws(() => validateSnapshot({ ...snapshot(), schemaVersion: 2 }));
});
test('inclusive antimeridian bounds and types apply before caps', () => {
  const s = snapshot();
  assert.equal(
    queryAirports(s, { west: 170, south: -90, east: -170, north: 90 }).matched,
    2,
  );
  assert.equal(queryAirports(s, {}).matched, 2);
  const result = queryAirports(s, { types: 'closed,small_airport', limit: 1 });
  assert.equal(result.matched, 2);
  assert.equal(result.truncated, true);
  assert.equal(result.total, 3);
  assert.throws(() => queryAirports(s, { west: 'junk' }));
});
test('search preserves duplicate codes', () => {
  assert.equal(searchAirports(snapshot(), 'DUP').matched, 2);
  assert.equal(searchAirports(snapshot(), 'München').airports[0].id, '1');
});

test('viewport cap prioritizes major airports before smaller facilities', () => {
  const s = snapshot();
  s.records = [
    { ...s.records[0], type: 'medium_airport' },
    { ...s.records[1], type: 'large_airport' },
  ];
  assert.equal(queryAirports(s, { limit: 1 }).airports[0].id, '2');
});

test('name search normalizes whitespace accents and punctuation before filtering', () => {
  assert.equal(
    searchAirports(snapshot(), '  Munchen   Field ').airports[0]?.id,
    '1',
  );
});

test('directory search and airport navigation share the same exact-name normalization', async () => {
  const { createAirportGeocoder } =
    await import('../../../src/search/airports.js');
  const provider = createAirportGeocoder({
    source: { search: async (query) => searchAirports(snapshot(), query) },
  });
  const outcome = await provider.geocode('Munchen  Field');
  assert.equal(outcome.place.airportId, '1');
  assert.equal(outcome.place.exact, true);
});
