import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
export const TRANSLATION_LOCALES = Object.freeze([
  'es',
  'ru',
  'zh-CN',
  'zh-TW',
  'ja',
  'ko',
]);
const projections = new WeakMap();
const catalogIndexes = new WeakMap();
const revisions = new WeakMap();
const localeViews = new WeakMap();
/**
 * How many localized projections stay resident per translation catalog. Each
 * projection duplicates the record index of the whole airport directory
 * (measured at roughly 58 MB for the 86,258-record snapshot), so caching all
 * six languages kept about 350 MB per server process. The least recently used
 * locale is dropped and rebuilt on demand instead.
 */
const PROJECTION_CACHE_LOCALES = 2;
/**
 * A stable per-locale view of the catalog entries, so `translationRevision`
 * hashes each locale once per catalog rather than on every projection build.
 */
function localeEntries(catalog, locale) {
  let views = localeViews.get(catalog);
  if (!views) localeViews.set(catalog, (views = new Map()));
  let view = views.get(locale);
  if (!view) {
    view = {
      entries: (catalog.entries || []).filter(
        (entry) => entry.locale === locale,
      ),
    };
    views.set(locale, view);
  }
  return view;
}
function translationRevision(catalog) {
  let revision = revisions.get(catalog);
  if (!revision) {
    revision = createHash('sha256')
      .update(
        JSON.stringify(
          [...(catalog.entries || [])]
            .sort((a, b) => key(a).localeCompare(key(b)))
            .map((e) => [
              e.kind,
              e.id,
              e.field,
              e.locale,
              e.fingerprint,
              e.text,
            ]),
        ),
      )
      .digest('hex');
    revisions.set(catalog, revision);
  }
  return revision;
}
const key = (e) => JSON.stringify([e.kind, String(e.id), e.field, e.locale]);
const fieldName = (field) => (field === 'navaidname' ? 'name' : field);
function fields(kind) {
  return kind === 'airport'
    ? ['name', 'municipality', 'region']
    : ['navaidname'];
}
export function fieldFingerprint(record, field) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        String(record.id),
        record.ident || '',
        record.countryCode || '',
        record.regionCode || '',
        record.associatedAirport || '',
        field,
        String(record[fieldName(field)] || ''),
      ]),
    )
    .digest('hex');
}
function validateEntry(e) {
  if (
    !e ||
    !['airport', 'navaid'].includes(e.kind) ||
    typeof e.id !== 'string' ||
    !e.id ||
    e.id.length > 100 ||
    !fields(e.kind).includes(e.field) ||
    !TRANSLATION_LOCALES.includes(e.locale) ||
    !/^[a-f0-9]{64}$/.test(e.fingerprint) ||
    typeof e.text !== 'string' ||
    !e.text.trim() ||
    e.text.length > 2000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(e.text) ||
    e.text !== e.text.trim() ||
    (e.status !== undefined && e.status !== 'translated') ||
    (e.standardVersion !== undefined && e.standardVersion !== 1) ||
    (e.updatedAt !== undefined &&
      (typeof e.updatedAt !== 'string' ||
        !Number.isFinite(Date.parse(e.updatedAt)))) ||
    (e.provenance !== undefined &&
      (!e.provenance ||
        typeof e.provenance.source !== 'string' ||
        !e.provenance.source.trim() ||
        e.provenance.source.length > 100)) ||
    (e.history !== undefined &&
      (!Array.isArray(e.history) || e.history.length > 1000))
  )
    throw Error('Invalid airport translation entry');
}
function index(catalog) {
  let result = catalogIndexes.get(catalog);
  if (!result) {
    result = new Map();
    for (const e of catalog.entries || []) {
      validateEntry(e);
      if (result.has(key(e)))
        throw Error('Duplicate airport translation entry');
      result.set(key(e), e);
    }
    catalogIndexes.set(catalog, result);
  }
  return result;
}
function* entities(snapshot) {
  for (const record of snapshot.records || []) yield ['airport', record];
  for (const record of snapshot.navaids || []) yield ['navaid', record];
}
export function* translationWorklist(snapshot, catalog, { locale } = {}) {
  const translations = index(catalog);
  for (const [kind, record] of entities(snapshot))
    for (const field of fields(kind)) {
      const source = record[fieldName(field)];
      if (!source) continue;
      const fingerprint = fieldFingerprint(record, field);
      for (const language of locale ? [locale] : TRANSLATION_LOCALES) {
        if (!TRANSLATION_LOCALES.includes(language))
          throw Error('Unsupported translation locale');
        const item = {
          kind,
          id: String(record.id),
          field,
          locale: language,
          fingerprint,
        };
        if (translations.get(key(item))?.fingerprint !== fingerprint)
          yield { ...item, source };
      }
    }
}
export function mergeTranslations(snapshot, catalog, entries) {
  const records = {
    airport: new Map((snapshot.records || []).map((r) => [String(r.id), r])),
    navaid: new Map((snapshot.navaids || []).map((r) => [String(r.id), r])),
  };
  const incoming = new Map();
  const current = index(catalog);
  const updatedAt = new Date().toISOString();
  for (const e of entries) {
    validateEntry(e);
    const record = records[e.kind].get(e.id);
    if (
      !record ||
      !record[fieldName(e.field)] ||
      fieldFingerprint(record, e.field) !== e.fingerprint
    )
      throw Error(`Stale airport translation: ${e.kind}/${e.id}/${e.field}`);
    if (
      incoming.has(key(e)) &&
      JSON.stringify(incoming.get(key(e))) !== JSON.stringify(e)
    )
      throw Error('Conflicting duplicate translation');
    incoming.set(key(e), { ...e });
  }
  const merged = new Map(current);
  for (const [k, e] of incoming) {
    const previous = current.get(k);
    if (
      previous &&
      previous.text === e.text &&
      previous.fingerprint === e.fingerprint &&
      !(
        e.provenance?.source === 'manual' &&
        previous.provenance?.source !== 'manual'
      )
    ) {
      if (
        previous.standardVersion === 1 &&
        previous.status === 'translated' &&
        previous.updatedAt &&
        previous.provenance?.source
      )
        continue;
      merged.set(k, {
        ...previous,
        standardVersion: 1,
        status: 'translated',
        updatedAt: previous.updatedAt || e.updatedAt || updatedAt,
        provenance: {
          ...e.provenance,
          ...previous.provenance,
          source:
            previous.provenance?.source || e.provenance?.source || 'manual',
        },
      });
      continue;
    }
    const source = e.provenance?.source || 'manual';
    if (
      previous &&
      (previous.provenance?.source || 'manual') === 'manual' &&
      source !== 'manual'
    )
      throw Error(`Manual translation conflict: ${e.kind}/${e.id}/${e.field}`);
    const history = previous
      ? [
          ...(previous.history || []),
          {
            text: previous.text,
            fingerprint: previous.fingerprint,
            updatedAt: previous.updatedAt || null,
            provenance: previous.provenance || { source: 'manual' },
            replacedAt: updatedAt,
          },
        ]
      : e.history;
    if (history?.length > 1000)
      throw Error('Translation audit history limit exceeded');
    merged.set(k, {
      ...e,
      provenance: { ...e.provenance, source },
      standardVersion: 1,
      status: 'translated',
      updatedAt: e.updatedAt || updatedAt,
      ...(history?.length ? { history } : {}),
    });
  }
  const result = {
    schemaVersion: 1,
    entries: [...merged.values()].sort((a, b) => key(a).localeCompare(key(b))),
  };
  result.translationRevision = translationRevision(result);
  return result;
}
export function localizeSnapshot(snapshot, catalog, locale) {
  if (!TRANSLATION_LOCALES.includes(locale)) return snapshot;
  let catalogs = projections.get(snapshot);
  if (!catalogs) projections.set(snapshot, (catalogs = new WeakMap()));
  let locales = catalogs.get(catalog);
  if (!locales) catalogs.set(catalog, (locales = new Map()));
  if (locales.has(locale)) {
    const cached = locales.get(locale);
    // Refresh recency: a Map iterates in insertion order, which is the order
    // the bound below evicts in.
    locales.delete(locale);
    locales.set(locale, cached);
    return cached;
  }
  const translations = index(catalog);
  const project = (record, kind) => {
    let copy;
    for (const field of fields(kind)) {
      const translated = translations.get(
        key({ kind, id: String(record.id), field, locale }),
      );
      if (
        translated &&
        translated.fingerprint === fieldFingerprint(record, field)
      ) {
        copy ||= { ...record, originalName: record.name };
        const property = fieldName(field);
        copy[`original${property[0].toUpperCase()}${property.slice(1)}`] =
          record[property];
        copy[property] = translated.text;
      }
    }
    if (!copy) return record;
    if (kind === 'airport') {
      copy.originalKeywords = record.keywords || '';
      copy.keywords = [
        record.keywords,
        record.name,
        record.municipality,
        record.region,
      ]
        .filter(Boolean)
        .join(', ');
    }
    return Object.freeze(copy);
  };
  const projected = Object.freeze({
    ...snapshot,
    locale,
    translationRevision: translationRevision(localeEntries(catalog, locale)),
    records: Object.freeze(
      (snapshot.records || []).map((r) => project(r, 'airport')),
    ),
    navaids: Object.freeze(
      (snapshot.navaids || []).map((r) => project(r, 'navaid')),
    ),
  });
  locales.set(locale, projected);
  while (locales.size > PROJECTION_CACHE_LOCALES)
    locales.delete(locales.keys().next().value);
  return projected;
}
export async function loadTranslationCatalog(directory) {
  const entries = [];
  let manifest;
  let hasManifest = false;
  try {
    hasManifest = true;
    manifest = JSON.parse(
      await readFile(join(directory, 'manifest.json'), 'utf8'),
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    hasManifest = false;
  }
  if (
    hasManifest &&
    (!manifest ||
      manifest.schemaVersion !== 1 ||
      !manifest.files ||
      typeof manifest.files !== 'object' ||
      Array.isArray(manifest.files))
  )
    throw Error('Invalid translation manifest');
  if (manifest)
    for (const [locale, filename] of Object.entries(manifest.files)) {
      if (
        !TRANSLATION_LOCALES.includes(locale) ||
        !new RegExp(`^${locale}\\.[a-f0-9]{64}\\.json$`).test(filename)
      )
        throw Error('Unsafe translation manifest filename');
    }
  for (const locale of TRANSLATION_LOCALES) {
    if (manifest && !manifest.files[locale]) continue;
    let file;
    try {
      const raw = await readFile(
        join(directory, manifest ? manifest.files[locale] : `${locale}.json`),
        'utf8',
      );
      if (
        manifest &&
        createHash('sha256').update(raw).digest('hex') !==
          manifest.files[locale].split('.')[1]
      )
        throw Error('Corrupt immutable translation file');
      file = JSON.parse(raw);
    } catch (error) {
      if (error.code === 'ENOENT' && !manifest) continue;
      throw error;
    }
    if (
      file.schemaVersion !== 1 ||
      file.locale !== locale ||
      !Array.isArray(file.entries)
    )
      throw Error(`Invalid ${locale} catalog`);
    for (const e of file.entries) {
      validateEntry(e);
      if (e.locale !== locale) throw Error('Translation locale mismatch');
      entries.push(Object.freeze(e));
    }
  }
  const catalog = Object.freeze({
    schemaVersion: 1,
    translationRevision: translationRevision({ entries }),
    entries: Object.freeze(entries),
  });
  index(catalog);
  return catalog;
}
