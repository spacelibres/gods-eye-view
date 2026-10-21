import { fieldFingerprint, TRANSLATION_LOCALES } from './localization.js';

/** Compile reviewed source-bound names; reuse geographic text with full context. */
export function compileAuthoredTranslations(snapshot, authored) {
  const identities = new Map();
  for (const record of snapshot.records) {
    if (identities.has(record.ident)) throw Error('Duplicate source ident');
    identities.set(record.ident, record);
  }
  const names = new Map(),
    cities = new Map(),
    regions = new Map();
  const regionKey = (r) =>
    JSON.stringify([r.countryCode, r.regionCode, r.region]);
  const cityKey = (r) =>
    JSON.stringify([r.countryCode, r.regionCode, r.municipality]);
  const add = (map, key, translations) => {
    const current = map.get(key) || {};
    for (const [locale, text] of Object.entries(translations)) {
      if (
        !TRANSLATION_LOCALES.includes(locale) ||
        typeof text !== 'string' ||
        !text.trim()
      )
        throw Error('Invalid authored language/text');
      if (current[locale] && current[locale] !== text)
        throw Error(`Conflicting authored context ${key}/${locale}`);
      current[locale] = text;
    }
    map.set(key, current);
  };
  for (const item of authored) {
    const record = identities.get(item.ident);
    if (!record || record.name !== item.sourceName)
      throw Error(`Authored source identity mismatch: ${item.ident}`);
    if (names.has(record.id)) throw Error('Duplicate authored ident');
    add(names, record.id, item.name);
    for (const [field, map, context] of [
      ['municipality', cities, cityKey],
      ['region', regions, regionKey],
    ]) {
      if (!item[field]) continue;
      const sourceField = `source${field[0].toUpperCase()}${field.slice(1)}`;
      if (!record[field] || record[field] !== item[sourceField])
        throw Error(`Authored source ${field} mismatch: ${item.ident}`);
      add(map, context(record), item[field]);
    }
  }
  const entries = [];
  for (const record of snapshot.records)
    for (const [field, values] of [
      ['name', names.get(record.id)],
      ['municipality', cities.get(cityKey(record))],
      ['region', regions.get(regionKey(record))],
    ]) {
      if (!values) continue;
      const fingerprint = fieldFingerprint(record, field);
      for (const [locale, text] of Object.entries(values))
        entries.push({
          kind: 'airport',
          id: record.id,
          field,
          locale,
          fingerprint,
          text,
          provenance: { source: 'project-authored', version: 1 },
          standardVersion: 1,
          status: 'translated',
          updatedAt: '2026-10-21T00:00:00Z',
        });
    }
  return entries;
}
