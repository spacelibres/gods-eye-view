export const AIRPORT_TYPES = Object.freeze([
  'large_airport',
  'medium_airport',
  'small_airport',
  'heliport',
  'seaplane_base',
  'balloonport',
  'closed',
]);
/** Shared name matching preserves code identity while tolerating human spelling. */
export const normalizeAirportName = (value) =>
  String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const strings = [
  'ident',
  'name',
  'countryCode',
  'country',
  'regionCode',
  'region',
  'municipality',
  'icaoCode',
  'iataCode',
  'gpsCode',
  'localCode',
  'keywords',
  'website',
  'wikipedia',
];
export function isAirportRecord(r) {
  return (
    !!r &&
    /^\d+$/.test(r.id) &&
    typeof r.id === 'string' &&
    AIRPORT_TYPES.includes(r.type) &&
    typeof r.lat === 'number' &&
    Number.isFinite(r.lat) &&
    Math.abs(r.lat) <= 90 &&
    typeof r.lon === 'number' &&
    Number.isFinite(r.lon) &&
    Math.abs(r.lon) <= 180 &&
    (r.elevationM === null ||
      (typeof r.elevationM === 'number' && Number.isFinite(r.elevationM))) &&
    strings.every((k) => typeof r[k] === 'string') &&
    !!r.name.trim() &&
    typeof r.scheduledService === 'boolean'
  );
}
