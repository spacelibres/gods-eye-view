import data from './usage-data.json' with { type: 'json' };

const byIcao = new Map();
for (const row of data.records) {
  const rows = byIcao.get(row.icaoCode) || [];
  rows.push(row);
  byIcao.set(row.icaoCode, rows);
}

// Location only validates that a reused ICAO still identifies this facility.
// The usage category always comes from explicit structured P31 statements.
function sameFacility(record, row) {
  const article = (value) => {
    try {
      const url = new URL(value);
      return url.hostname === 'en.wikipedia.org' &&
        url.pathname.startsWith('/wiki/')
        ? decodeURIComponent(url.pathname.slice(6))
            .replaceAll('_', ' ')
            .normalize('NFC')
        : '';
    } catch {
      return '';
    }
  };
  const currentArticle = article(record?.wikipedia);
  if (!currentArticle || currentArticle !== article(row.wikipedia))
    return false;
  if (![record?.lat, record?.lon, row.lat, row.lon].every(Number.isFinite))
    return false;
  const rad = Math.PI / 180;
  const dLat = (record.lat - row.lat) * rad;
  const dLon = (record.lon - row.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(record.lat * rad) *
      Math.cos(row.lat * rad) *
      Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h))) <= 5;
}

/** Usage evidence is orthogonal to physical type (heliport, seaplane base, etc.). */
export function resolveAirportUsage(record) {
  const code =
    typeof record?.icaoCode === 'string' ? record.icaoCode.toUpperCase() : '';
  let rows = /^[A-Z]{4}$/.test(code) ? byIcao.get(code) || [] : [];
  const ambiguous = new Set(rows.map((row) => row.item)).size > 1;
  if (ambiguous) rows = [];
  rows = rows.filter((row) => sameFacility(record, row));
  const joint = rows.some((row) => row.kind === 'joint');
  const military = rows.some((row) => row.kind === 'military');
  const civil = record?.scheduledService === true;
  const kind =
    joint || (military && civil)
      ? 'joint'
      : military
        ? 'military'
        : civil
          ? 'civil'
          : 'unknown';
  const evidence = rows.map(
    (row) =>
      `${row.item}: Wikidata P31 ${data.classes[row.kind]} (${row.kind === 'joint' ? 'joint-use aerodrome' : 'airbase'}), joined by P239 ICAO ${code} with facility location identity checked within 5 km.`,
  );
  if (ambiguous)
    evidence.push(
      `Wikidata ICAO ${code} matches multiple entities; classification withheld because identity is ambiguous.`,
    );
  if (civil)
    evidence.push(
      'OurAirports scheduledService=true confirms scheduled civil service; military use is not ruled out. Source: https://ourairports.com/data/',
    );
  return {
    kind,
    source: [rows.length ? data.source : '', civil ? 'OurAirports' : '']
      .filter(Boolean)
      .join(' + '),
    sourceUrl: rows.length
      ? `https://www.wikidata.org/wiki/${rows.find((row) => row.kind === (joint ? 'joint' : 'military')).item}`
      : civil
        ? 'https://ourairports.com/data/'
        : '',
    checkedAt: rows.length
      ? rows[0].auditedAt || rows[0].checkedAt || data.checkedAt
      : '',
    evidence,
  };
}
