import {
  isCountryRecord,
  isNavaidRecord,
  NAVAID_TYPES,
} from '../../../src/sources/airports/records.js';
import {
  isAirportRecord,
  AIRPORT_TYPES,
  normalizeAirportName,
} from '../../../src/sources/airports/records.js';
const indexes = new WeakMap();
export function airportIndexes(snapshot) {
  let index = indexes.get(snapshot);
  if (index) return index;
  index = {
    ids: new Map(),
    codes: new Map(),
    cells: new Map(),
    names: new Map(),
  };
  for (const record of snapshot.records) {
    index.ids.set(record.id, record);
    index.names.set(record.id, {
      name: normalizeAirportName(record.name),
      keywords: normalizeAirportName(record.keywords),
    });
    for (const code of new Set([
      record.icaoCode,
      record.iataCode,
      record.gpsCode,
      record.localCode,
      record.ident,
    ])) {
      if (!code) continue;
      const key = code.toLocaleLowerCase();
      const entries = index.codes.get(key) || [];
      entries.push(record);
      index.codes.set(key, entries);
    }
    const key = `${Math.floor(record.lon / 5)},${Math.floor(record.lat / 5)}`;
    const entries = index.cells.get(key) || [];
    entries.push(record);
    index.cells.set(key, entries);
  }
  indexes.set(snapshot, index);
  return index;
}
export function parseCsv(text) {
  const rows = [];
  let row = [],
    value = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(value);
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      value = '';
    } else value += c;
  }
  if (quoted) throw Error('Unterminated CSV quote');
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  if (!rows.length) throw Error('Empty CSV');
  const headers = rows.shift().map((v) => v.replace(/^\uFEFF/, ''));
  if (new Set(headers).size !== headers.length)
    throw Error('Duplicate CSV header');
  return {
    headers,
    rows: rows.map((r) => {
      if (r.length !== headers.length) throw Error('CSV column mismatch');
      return Object.fromEntries(headers.map((k, i) => [k, r[i]]));
    }),
  };
}
function table(text, required) {
  const t = parseCsv(text);
  for (const h of required)
    if (!t.headers.includes(h)) throw Error('Missing CSV header ' + h);
  return t.rows;
}
function names(text) {
  const map = new Map();
  for (const r of table(text, ['code', 'name'])) {
    if (!r.code || map.has(r.code))
      throw Error('Duplicate/empty reference code');
    map.set(r.code, r.name);
  }
  return map;
}
export function validateAirportReferences(countries, regions, records) {
  const countriesByCode = names(countries),
    regionsByCode = names(regions);
  if (
    countriesByCode.size < 200 ||
    regionsByCode.size < 1000 ||
    [...countriesByCode.values(), ...regionsByCode.values()].some(
      (name) => !name.trim(),
    )
  )
    throw Error('Incomplete airport reference tables');
  for (const record of records) {
    if (
      (record.countryCode && !countriesByCode.has(record.countryCode)) ||
      (record.regionCode && !regionsByCode.has(record.regionCode))
    )
      throw Error('Unresolved airport reference ' + record.id);
  }
}
const numeric = (v) =>
  typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
    ? Number(v)
    : null;
export function parseAirportCsv(text, countries, regions) {
  const cn = names(countries),
    rn = names(regions),
    ids = new Set(),
    records = [];
  for (const r of table(text, [
    'id',
    'ident',
    'type',
    'name',
    'latitude_deg',
    'longitude_deg',
    'elevation_ft',
    'iso_country',
    'iso_region',
    'municipality',
    'scheduled_service',
    'icao_code',
    'iata_code',
    'gps_code',
    'local_code',
    'home_link',
    'wikipedia_link',
    'keywords',
  ])) {
    if (!/^\d+$/.test(r.id) || ids.has(r.id))
      throw Error('Invalid/duplicate airport ID');
    ids.add(r.id);
    const lat = numeric(r.latitude_deg),
      lon = numeric(r.longitude_deg),
      ft = numeric(r.elevation_ft);
    if (
      lat === null ||
      lon === null ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    )
      continue;
    const record = {
      id: r.id,
      ident: r.ident,
      name: r.name,
      type: r.type,
      lat,
      lon,
      elevationM: ft === null ? null : ft * 0.3048,
      countryCode: r.iso_country,
      country: cn.get(r.iso_country) || '',
      regionCode: r.iso_region,
      region: rn.get(r.iso_region) || '',
      municipality: r.municipality,
      icaoCode: r.icao_code || '',
      iataCode: r.iata_code,
      gpsCode: r.gps_code,
      localCode: r.local_code,
      scheduledService: r.scheduled_service === 'yes',
      keywords: r.keywords,
      website: r.home_link,
      wikipedia: r.wikipedia_link,
    };
    if (!isAirportRecord(record)) throw Error('Invalid airport record ' + r.id);
    records.push(record);
  }
  return records;
}
export function validateSnapshot(s, { production = false } = {}) {
  if (
    !s ||
    s.schemaVersion !== 1 ||
    !/^[a-f0-9]{40}$/.test(s.revision) ||
    !Number.isFinite(Date.parse(s.updatedAt)) ||
    s.source !== 'OurAirports' ||
    typeof s.sourceUrl !== 'string' ||
    !Array.isArray(s.records) ||
    !s.records.length
  )
    throw Error('Invalid airport snapshot');
  const ids = new Set();
  for (const r of s.records) {
    if (!isAirportRecord(r) || ids.has(r.id))
      throw Error('Invalid/duplicate airport record');
    ids.add(r.id);
  }
  if (
    production &&
    (s.records.length < 50000 ||
      s.records.filter((r) => r.type === 'large_airport').length < 500 ||
      new Set(s.records.map((r) => r.countryCode)).size < 200)
  )
    throw Error('Incomplete global airport directory');
  if (s.countries !== undefined || s.navaids !== undefined) {
    if (
      !Array.isArray(s.countries) ||
      !Array.isArray(s.navaids) ||
      !s.countries.every(isCountryRecord) ||
      !s.navaids.every(isNavaidRecord) ||
      new Set(s.countries.map((r) => r.code)).size !== s.countries.length ||
      new Set(s.navaids.map((r) => r.id)).size !== s.navaids.length
    )
      throw Error('Invalid aviation references');
    const codes = new Set(s.countries.map((r) => r.code));
    if (s.navaids.some((r) => r.countryCode && !codes.has(r.countryCode)))
      throw Error('Unresolved navaid reference');
    if (
      production &&
      (s.countries.length < 200 ||
        s.navaids.length < 8000 ||
        new Set(s.navaids.map((r) => r.countryCode)).size < 150)
    )
      throw Error('Incomplete aviation references');
  }
  return s;
}
export function metadata(s) {
  return {
    revision: s.revision,
    updatedAt: s.updatedAt,
    source: s.source,
    sourceUrl: s.sourceUrl,
    ...(s.locale
      ? { locale: s.locale, translationRevision: s.translationRevision }
      : {}),
  };
}
function limitValue(v, max = 2000) {
  if (v === undefined) return Math.min(1200, max);
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw Error('Invalid limit');
  return Math.min(n, max);
}
function list(s, records, limit) {
  return {
    ...metadata(s),
    total: s.records.length,
    matched: records.length,
    truncated: records.length > limit,
    airports: records.slice(0, limit),
  };
}
export function queryAirports(s, q = {}) {
  const b = { west: -180, south: -90, east: 180, north: 90 };
  for (const k of Object.keys(b))
    if (q[k] !== undefined) {
      if (
        String(q[k]).trim() === '' ||
        !Number.isFinite(Number(q[k])) ||
        Math.abs(Number(q[k])) > (k === 'north' || k === 'south' ? 90 : 180)
      )
        throw Error('Invalid bounds');
      b[k] = Number(q[k]);
    }
  if (b.south > b.north) throw Error('Invalid latitude bounds');
  const types =
    q.types === undefined
      ? AIRPORT_TYPES.filter((t) => t !== 'closed')
      : Array.isArray(q.types)
        ? q.types
        : String(q.types).split(',');
  if (!types.length || types.some((t) => !AIRPORT_TYPES.includes(t)))
    throw Error('Invalid types');
  const candidates = [];
  for (const [cell, entries] of airportIndexes(s).cells) {
    const [x, y] = cell.split(',').map(Number);
    if (y * 5 > b.north || (y + 1) * 5 < b.south) continue;
    const intersects =
      b.west <= b.east
        ? x * 5 <= b.east && (x + 1) * 5 >= b.west
        : (x + 1) * 5 >= b.west || x * 5 <= b.east;
    if (intersects) candidates.push(...entries);
  }
  const records = candidates.filter(
    (r) =>
      types.includes(r.type) &&
      r.lat >= b.south &&
      r.lat <= b.north &&
      (b.west <= b.east
        ? r.lon >= b.west && r.lon <= b.east
        : r.lon >= b.west || r.lon <= b.east),
  );
  records.sort(
    (a, b) =>
      AIRPORT_TYPES.indexOf(a.type) - AIRPORT_TYPES.indexOf(b.type) ||
      a.id.localeCompare(b.id),
  );
  return list(s, records, limitValue(q.limit));
}
export function searchAirports(s, query, { limit = 8 } = {}) {
  const raw = String(query || '')
    .trim()
    .toLocaleLowerCase();
  if (raw.length > 200) throw Error('Query too long');
  const q = normalizeAirportName(raw);
  const index = airportIndexes(s);
  const exact = new Set(
    (index.codes.get(raw) || []).map((record) => record.id),
  );
  const rank = (r) =>
    exact.has(r.id)
      ? 0
      : index.names.get(r.id).name === q
        ? 1
        : index.names.get(r.id).name.startsWith(q)
          ? 2
          : index.names.get(r.id).name.includes(q)
            ? 3
            : index.names.get(r.id).keywords.includes(q)
              ? 4
              : 99;
  const matches = q
    ? s.records
        .map((r) => ({ r, rank: rank(r) }))
        .filter((v) => v.rank < 99)
        .sort(
          (a, b) =>
            a.rank - b.rank ||
            a.r.name.localeCompare(b.r.name) ||
            a.r.id.localeCompare(b.r.id),
        )
        .map((v) => v.r)
    : [];
  return list(s, matches, limitValue(limit, 50));
}

export function parseCountryCsv(text) {
  const result = table(text, [
    'code',
    'name',
    'continent',
    'wikipedia_link',
    'keywords',
  ]).map((r) => ({
    code: r.code,
    name: r.name,
    continent: r.continent,
    wikipedia: r.wikipedia_link,
    keywords: r.keywords,
  }));
  if (
    result.some((r) => !isCountryRecord(r)) ||
    new Set(result.map((r) => r.code)).size !== result.length
  )
    throw Error('Invalid country references');
  return result;
}
export function parseNavaidCsv(text, countries) {
  const cn = new Map(countries.map((r) => [r.code, r.name])),
    ids = new Set();
  return table(text, [
    'id',
    'ident',
    'name',
    'type',
    'frequency_khz',
    'latitude_deg',
    'longitude_deg',
    'elevation_ft',
    'iso_country',
    'dme_frequency_khz',
    'dme_channel',
    'dme_latitude_deg',
    'dme_longitude_deg',
    'dme_elevation_ft',
    'slaved_variation_deg',
    'magnetic_variation_deg',
    'usageType',
    'power',
    'associated_airport',
  ]).map((r) => {
    const metres = (v) => (numeric(v) === null ? null : numeric(v) * 0.3048);
    const record = {
      id: r.id,
      ident: r.ident,
      name: r.name,
      type: r.type,
      lat: numeric(r.latitude_deg),
      lon: numeric(r.longitude_deg),
      elevationM: metres(r.elevation_ft),
      countryCode: r.iso_country,
      country: cn.get(r.iso_country) || '',
      frequencyKhz: numeric(r.frequency_khz),
      dmeFrequencyKhz: numeric(r.dme_frequency_khz),
      dmeChannel: r.dme_channel,
      dmeLat: numeric(r.dme_latitude_deg),
      dmeLon: numeric(r.dme_longitude_deg),
      dmeElevationM: metres(r.dme_elevation_ft),
      slavedVariationDeg: numeric(r.slaved_variation_deg),
      magneticVariationDeg: numeric(r.magnetic_variation_deg),
      usageType: r.usageType,
      power: r.power,
      associatedAirport: r.associated_airport,
    };
    if (
      !isNavaidRecord(record) ||
      ids.has(record.id) ||
      (record.countryCode && !cn.has(record.countryCode))
    )
      throw Error('Invalid navaid reference ' + r.id);
    ids.add(record.id);
    return record;
  });
}
export function queryNavaids(s, q = {}) {
  if (!s.navaids) throw Error('Navaids unavailable');
  const b = { west: -180, south: -90, east: 180, north: 90 };
  for (const k of Object.keys(b))
    if (q[k] !== undefined) {
      if (
        String(q[k]).trim() === '' ||
        !Number.isFinite(Number(q[k])) ||
        Math.abs(Number(q[k])) > (k === 'south' || k === 'north' ? 90 : 180)
      )
        throw Error('Invalid bounds');
      b[k] = Number(q[k]);
    }
  if (b.south > b.north) throw Error('Invalid bounds');
  if (q.type !== undefined && !NAVAID_TYPES.includes(q.type))
    throw Error('Invalid navaid type');
  const raw = String(q.q ?? '').trim();
  if (raw.length > 200) throw Error('Query too long');
  const query = normalizeAirportName(raw);
  const records = s.navaids.filter(
    (r) =>
      (!q.type || q.type === r.type) &&
      r.lat >= b.south &&
      r.lat <= b.north &&
      (b.west <= b.east
        ? r.lon >= b.west && r.lon <= b.east
        : r.lon >= b.west || r.lon <= b.east) &&
      (!query ||
        [r.ident, r.name, r.country, r.countryCode, r.associatedAirport].some(
          (v) => normalizeAirportName(v).includes(query),
        )),
  );
  records.sort(
    (a, b) =>
      (a.ident.toLowerCase() === raw.toLowerCase() ? 0 : 1) -
        (b.ident.toLowerCase() === raw.toLowerCase() ? 0 : 1) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
  const limit = limitValue(q.limit, 1200);
  return {
    ...metadata(s),
    total: s.navaids.length,
    matched: records.length,
    truncated: records.length > limit,
    navaids: records.slice(0, limit),
  };
}
