import { readFile, writeFile } from 'node:fs/promises';

// Cache WDQS JSON responses before import; never fetch in the browser.
// node scripts/import-airport-usage.mjs military-response.json [joint-response.json]
// Optional AIRPORT_USAGE_CHECKED_AT=YYYY-MM-DD, AIRPORT_USAGE_AUDIT=entities.json.
// AIRPORT_USAGE_SITELINKS may hold a wbgetentities props=sitelinks response map.
if (!process.argv[2])
  throw new Error('A military WDQS bulk response is required.');
const checkedAt =
  process.env.AIRPORT_USAGE_CHECKED_AT || new Date().toISOString().slice(0, 10);
if (
  !/^\d{4}-\d{2}-\d{2}$/.test(checkedAt) ||
  !Number.isFinite(Date.parse(checkedAt))
)
  throw new Error('Invalid check date.');
const audit = process.env.AIRPORT_USAGE_AUDIT
  ? JSON.parse(await readFile(process.env.AIRPORT_USAGE_AUDIT, 'utf8'))
  : {};
const sitelinks = process.env.AIRPORT_USAGE_SITELINKS
  ? JSON.parse(await readFile(process.env.AIRPORT_USAGE_SITELINKS, 'utf8'))
  : {};
const exclusions = [
  {
    item: 'Q5607481',
    sourceUrl: 'https://www.flymanchester.com/about-the-airport/history/',
    checkedAt: '2026-10-21',
    evidence:
      'Official airport history: all remaining Air Force flying units relocated and control transferred to municipalities in January 1966. Former Grenier Air Force Base does not establish current military use at KMHT.',
  },
];
const active = (claim) =>
  claim.rank !== 'deprecated' &&
  claim.mainsnak?.snaktype === 'value' &&
  !(claim.qualifiers?.P582 || []).some(
    (q) => (q.datavalue?.value?.time || '').slice(1, 11) <= checkedAt,
  );
const values = (entity, property) =>
  (entity?.claims?.[property] || [])
    .filter(active)
    .map((claim) => claim.mainsnak.datavalue?.value);
const classes = { military: 'Q695850', joint: 'Q5124659' };
const queries = Object.fromEntries(
  Object.entries(classes).map(([kind, id]) => [
    kind,
    `SELECT ?item ?icao WHERE { ?item wdt:P31 wd:${id}; wdt:P239 ?icao. }`,
  ]),
);
const records = [];
// Fallback verified against the item's explicit P31 and P239 statements, 2026-10-21.
// WDQS bulk joint query was unavailable (429 during upstream outage).
records.push({
  icaoCode: 'ZBZJ',
  kind: 'joint',
  item: 'Q8070469',
  checkedAt: '2026-10-21',
  wikipedia: 'https://en.wikipedia.org/wiki/Zhangjiakou_Ningyuan_Airport',
});
const validMilitary = new Set();
for (const [i, kind] of ['military', 'joint'].entries()) {
  if (!process.argv[i + 2]) continue;
  const data = JSON.parse(await readFile(process.argv[i + 2], 'utf8'));
  if (!Array.isArray(data.results?.bindings))
    throw new Error('Invalid WDQS bindings.');
  for (const row of data.results.bindings) {
    if (
      typeof row.icao?.value !== 'string' ||
      typeof row.item?.value !== 'string'
    )
      throw new Error('Malformed WDQS row.');
    const icaoCode = row.icao.value;
    const item = row.item.value.split('/').pop();
    if (!/^[A-Z]{4}$/.test(icaoCode) || !/^Q\d+$/.test(item)) continue;
    if (kind === 'military') validMilitary.add(`${icaoCode}:${item}`);
    records.push({ icaoCode, kind, item });
  }
}
if (validMilitary.size < 500)
  throw new Error(
    'Refusing to overwrite the global table with fewer than 500 valid military statements.',
  );
for (const row of [...records]) {
  if (
    row.kind === 'military' &&
    values(audit[row.item], 'P31').some((v) => v?.id === classes.joint)
  )
    records.push({ ...row, kind: 'joint' });
}
let removed = 0;
for (let i = records.length - 1; i >= 0; i--) {
  const row = records[i];
  if (exclusions.some((entry) => entry.item === row.item)) {
    records.splice(i, 1);
    removed++;
    continue;
  }
  const title = (sitelinks[row.item] || audit[row.item])?.sitelinks?.enwiki
    ?.title;
  if (typeof title === 'string')
    row.wikipedia = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`;
  const entity = audit[row.item];
  if (!entity) continue;
  const dissolved = values(entity, 'P576').some(
    (v) => typeof v?.time === 'string' && v.time.slice(1, 11) <= checkedAt,
  );
  if (
    dissolved ||
    !values(entity, 'P31').some((v) => v?.id === classes[row.kind]) ||
    !values(entity, 'P239').includes(row.icaoCode)
  ) {
    records.splice(i, 1);
    removed++;
    continue;
  }
  const coord = values(entity, 'P625').find(
    (v) =>
      Number.isFinite(v?.latitude) &&
      Number.isFinite(v?.longitude) &&
      v.globe === 'http://www.wikidata.org/entity/Q2',
  );
  if (coord) {
    row.lat = coord.latitude;
    row.lon = coord.longitude;
  }
  row.auditedAt = checkedAt;
}
records.sort(
  (a, b) =>
    a.icaoCode.localeCompare(b.icaoCode) ||
    a.kind.localeCompare(b.kind) ||
    a.item.localeCompare(b.item),
);
const unique = [
  ...new Map(
    records.map((r) => [`${r.icaoCode}:${r.kind}:${r.item}`, r]),
  ).values(),
];
await writeFile(
  'src/sources/airports/usage-data.json',
  JSON.stringify(
    {
      schemaVersion: 1,
      checkedAt,
      manualEvidence: [
        {
          item: 'Q8070469',
          checkedAt: '2026-10-21',
          sourceUrl: 'https://www.wikidata.org/wiki/Q8070469',
        },
      ],
      exclusions,
      audit: {
        entityCount: Object.keys(audit).length,
        excludedStatements: removed,
        sourceUrl: 'https://www.wikidata.org/w/api.php',
        identityToleranceKm: 5,
      },
      source: 'Wikidata',
      sourceUrl: 'https://query.wikidata.org/',
      license: 'CC0-1.0',
      classes,
      queries,
      publicationDate: '',
      limitations: [
        'Direct truthy P31 class and P239 ICAO statements only; no names, IATA codes, subclass inference or proximity matching.',
        'Community-maintained structured evidence can be incomplete or stale and does not establish exclusive military use.',
        'Bulk discovery covers the direct airbase class. Joint-use coverage includes active Q5124659 P31 claims found during entity audits, scheduled civil service combined with airbase evidence, and independently checked Q8070469.',
        'Audited entities exclude deprecated or ended P31/P239 claims and dissolved entities. Classification requires exact ICAO, matching English Wikipedia article identity, and a location within 5 km. These checks validate facility identity and never infer usage; absent or different article links and absent coordinates suppress classification.',
        'No original publication date is asserted: Wikidata is a continuously edited database; checkedAt is the retrieval date.',
        'Multiple class statements for one item retain all evidence; joint classification takes precedence only after unambiguous identity matching.',
        'Only exact explicit icaoCode joins are accepted. Missing ICAO and unmatched records remain unconfirmed unless scheduled civil service is present.',
      ],
      records: unique,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Imported ${unique.length} explicit ICAO classification statements.`,
);
