import { resolveAirportUsage } from '../../sources/airports/usage.js';
import { airportSymbol, airportLegendImage } from './symbols.js';
export { resolveAirportUsage, airportSymbol };
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
  const usage = resolveAirportUsage(airport);
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
      usageKind: usage.kind,
      usageSource: usage.source,
      usageSourceUrl: usage.sourceUrl,
      usageCheckedAt: usage.checkedAt,
      usageEvidence: usage.evidence,
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
const USAGE_LABELS = Object.freeze({
  civil: msg('Civil aviation service confirmed'),
  military: msg('Military airfield'),
  joint: msg('Joint-use airfield'),
  unknown: msg('Airport usage unconfirmed'),
});
export function airportLegend(records, t = (v) => v, color) {
  const definitions = [
    ['large_airport', 'civil'],
    ['large_airport', 'military'],
    ['large_airport', 'joint'],
    ['small_airport', 'unknown'],
    ['heliport', 'unknown'],
    ['seaplane_base', 'unknown'],
    ['balloonport', 'unknown'],
  ];
  const counts = new Map();
  for (const record of records) {
    const symbol = airportSymbol(record, resolveAirportUsage(record).kind);
    const key = ['helicopter', 'seaplane', 'balloon'].includes(symbol.facility)
      ? symbol.facility
      : symbol.kind;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return definitions.map(([type, usage]) => {
    const symbol = airportSymbol({ type }, usage);
    const key = ['helicopter', 'seaplane', 'balloon'].includes(symbol.facility)
      ? symbol.facility
      : symbol.kind;
    return {
      label: t(symbol.label),
      icon: airportLegendImage(symbol, color),
      count: counts.get(key) || 0,
      blurb: t('Visible airports only'),
    };
  });
}
export function airportDetailRows(a, p, t = (value) => value) {
  const date = p.updatedAt ? new Date(p.updatedAt) : null;
  const usage = resolveAirportUsage(a);
  return [
    [msg('Airport'), a.name],
    [msg('OurAirports ID'), a.id],
    [msg('Ident'), a.ident],
    [msg('ICAO'), a.icaoCode],
    [msg('IATA'), a.iataCode],
    [msg('GPS code'), a.gpsCode],
    [msg('Local code'), a.localCode],
    [msg('Type'), t(TYPE_LABELS[a.type] || msg('Unknown'))],
    [msg('Airport use'), t(USAGE_LABELS[usage.kind])],
    ...(usage.source
      ? [[msg('Usage classification source'), usage.source]]
      : []),
    ...(usage.sourceUrl ? [[msg('Usage source URL'), usage.sourceUrl]] : []),
    ...(usage.evidence.length
      ? [[msg('Usage evidence'), usage.evidence.join(' · ')]]
      : []),
    ...(usage.checkedAt || (usage.kind === 'civil' && p.updatedAt)
      ? [[msg('Usage checked'), usage.checkedAt || p.updatedAt]]
      : []),
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
export function airportDescription(
  a,
  p,
  t = (value) => value,
  countryFlagUrl = () => null,
) {
  const rows = airportDetailRows(a, p, t);
  const flag = countryFlagUrl({
    countryCode: a.countryCode,
    countryName: a.country,
  });
  return `<table>${rows
    .map(([label, value]) => {
      const cell =
        value === null || value === undefined || value === ''
          ? t('Unknown')
          : value;
      const flagImg =
        label === 'Country' && flag
          ? `<img class="country-flag" src="${escape(flag)}" alt="" aria-hidden="true">`
          : '';
      return `<tr><th>${escape(t(label))}</th><td>${flagImg}${escape(cell)}</td></tr>`;
    })
    .join('')}</table>`;
}

/** Primary facts for the on-map card; detailed evidence stays in context. */
export function airportReadout(
  a,
  p,
  t = (value) => value,
  locale = 'en',
  countryFlagUrl = () => null,
) {
  const facts = new Set([
    'Type',
    'Airport use',
    'Municipality',
    'Country',
    'Coordinates',
    'Elevation (m MSL)',
  ]);
  let country = a.country || a.countryCode;
  try {
    if (/^[A-Z]{2}$/.test(a.countryCode)) {
      const name = new Intl.DisplayNames([locale], { type: 'region' }).of(
        a.countryCode,
      );
      if (name && name !== a.countryCode) country = name;
    }
  } catch {
    /* Keep the directory value when region names are unavailable. */
  }
  const codes = [];
  // i18n-ignore: ICAO and IATA are standardized identifier badges.
  if (a.icaoCode) codes.push({ label: 'ICAO', value: a.icaoCode });
  // i18n-ignore: IATA code badge.
  if (a.iataCode) codes.push({ label: 'IATA', value: a.iataCode });
  if (!codes.length && a.ident)
    codes.push({ label: t(msg('Ident')), value: a.ident });
  return {
    title: a.name,
    symbol: airportSymbol(a, resolveAirportUsage(a).kind).image,
    codes,
    countryFlag: countryFlagUrl({
      countryCode: a.countryCode,
      countryName: a.country,
    }),
    rows: airportDetailRows(a, p, t)
      .filter(([label]) => facts.has(label))
      .map(([label, rawValue]) => {
        const value = label === 'Country' ? country : rawValue;
        return [
          label,
          value === null || value === undefined || value === ''
            ? t('Unknown')
            : value,
        ];
      }),
    source: p.source || 'OurAirports',
    sourceUrl: p.sourceUrl,
  };
}
