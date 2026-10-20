export const AIRPORT_POINT_LIMIT = 1200;
export const AIRPORT_LABEL_LIMIT = 96;
// Portable extraction marker: application translation is injected by the host.
const msg = (value) => value;
export function airportTypesForHeight(height) {
  return height < 750000
    ? [
        'large_airport',
        'medium_airport',
        'small_airport',
        'heliport',
        'seaplane_base',
        'balloonport',
      ]
    : ['large_airport', 'medium_airport'];
}
export function selectAirports(records, types) {
  const allowed = new Set(types);
  const rank = { large_airport: 0, medium_airport: 1, small_airport: 2 };
  return (Array.isArray(records) ? records : [])
    .filter(
      (a) =>
        a &&
        allowed.has(a.type) &&
        a.type !== 'closed' &&
        Number.isFinite(a.lat) &&
        Number.isFinite(a.lon) &&
        Math.abs(a.lat) <= 90 &&
        Math.abs(a.lon) <= 180,
    )
    .sort(
      (a, b) =>
        (rank[a.type] ?? 3) - (rank[b.type] ?? 3) ||
        String(a.id).localeCompare(String(b.id)),
    )
    .slice(0, AIRPORT_POINT_LIMIT);
}
export function airportContext(airport, snapshot) {
  return {
    id: `airport:${airport.id}`,
    layerId: 'airports',
    layerName: 'Airports',
    label: airport.name,
    source: snapshot.source || 'OurAirports',
    latitude: airport.lat,
    longitude: airport.lon,
    properties: {
      ...airport,
      icaoCode: airport.icaoCode || null,
      iataCode: airport.iataCode || null,
      elevationM: Number.isFinite(airport.elevationM)
        ? airport.elevationM
        : null,
      revision: snapshot.revision ?? null,
      updatedAt: snapshot.updatedAt ?? null,
      source: snapshot.source || 'OurAirports',
      sourceUrl: snapshot.sourceUrl ?? null,
    },
  };
}
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const TYPE_LABELS = Object.freeze({
  large_airport: msg('Large airport'),
  medium_airport: msg('Medium airport'),
  small_airport: msg('Small airport'),
  heliport: msg('Heliport'),
  seaplane_base: msg('Seaplane base'),
  balloonport: msg('Balloonport'),
  closed: msg('Closed airport'),
});
export function airportDetailRows(a, p, t = (value) => value) {
  const date = p.updatedAt ? new Date(p.updatedAt) : null;
  return [
    [msg('Airport'), a.name],
    [msg('OurAirports ID'), a.id],
    [msg('Ident'), a.ident],
    [msg('ICAO'), a.icaoCode],
    [msg('IATA'), a.iataCode],
    [msg('GPS code'), a.gpsCode],
    [msg('Local code'), a.localCode],
    [msg('Type'), t(TYPE_LABELS[a.type] || msg('Unknown'))],
    [msg('Municipality'), a.municipality],
    [msg('Country'), a.country || a.countryCode],
    [msg('Coordinates'), `${a.lat}, ${a.lon}`],
    [
      msg('Elevation (m MSL)'),
      Number.isFinite(a.elevationM) ? a.elevationM : null,
    ],
    [msg('Source'), p.source],
    [msg('Source URL'), p.sourceUrl],
    [msg('Revision'), p.revision],
    [
      msg('Updated'),
      date && Number.isFinite(date.getTime())
        ? `${date.toLocaleString()} UTC${-date.getTimezoneOffset() / 60 >= 0 ? '+' : ''}${-date.getTimezoneOffset() / 60}`
        : null,
    ],
  ];
}
export function airportDescription(a, p, t = (value) => value) {
  const rows = airportDetailRows(a, p, t);
  return `<table>${rows.map(([label, value]) => `<tr><th>${escape(t(label))}</th><td>${escape(value === null || value === undefined || value === '' ? t('Unknown') : value)}</td></tr>`).join('')}</table>`;
}
