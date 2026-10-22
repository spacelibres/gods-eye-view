#!/usr/bin/env node
import { readFile, rename, mkdir, unlink, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import { compileAuthoredTranslations } from '../server/providers/airports/authoredTranslations.js';
import { acquireFileLock } from '../server/providers/airports/fileLock.js';
import {
  TRANSLATION_LOCALES,
  loadTranslationCatalog,
  translationWorklist,
  mergeTranslations,
} from '../server/providers/airports/localization.js';
const [command, ...args] = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (
    ![
      '--snapshot',
      '--catalog',
      '--catalog-dir',
      '--input',
      '--authored',
      '--locale',
      '--limit',
      '--output',
    ].includes(args[i]) ||
    !args[i + 1]
  )
    throw Error(
      'Expected --snapshot, --catalog, --input, --authored, --locale, --limit or --output value',
    );
  options[args[i].slice(2)] = args[i + 1];
}
async function emit(text) {
  if (!process.stdout.write(text)) await once(process.stdout, 'drain');
}
let releaseLock;
async function durableWrite(path, data) {
  const handle = await open(path, 'w');
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function main() {
  if (!['export', 'import', 'report'].includes(command))
    throw Error(
      'Usage: node scripts/airport-translations.mjs export|import|report [--snapshot file] [--catalog directory] [--locale language] [--limit count] [--input file] [--output file]',
    );
  if (options.locale && !TRANSLATION_LOCALES.includes(options.locale))
    throw Error('Unsupported translation locale');
  const directory = resolve(
    options['catalog-dir'] ||
      options.catalog ||
      'server/data/airports/translations',
  );
  const stored = JSON.parse(
    await readFile(
      resolve(options.snapshot || 'server/data/airports/snapshot.json'),
      'utf8',
    ),
  );
  const snapshot = stored.snapshot || stored;
  if (command === 'import') {
    await mkdir(directory, { recursive: true });
    releaseLock = await acquireFileLock(join(directory, '.import.lock'));
  }
  const catalog = await loadTranslationCatalog(directory);
  if (command === 'report') {
    const locales = Object.fromEntries(
      TRANSLATION_LOCALES.map((locale) => [
        locale,
        {
          valid: 0,
          missing: 0,
          stale: 0,
          manual: 0,
          failed: 0,
          pending: 0,
          translated: 0,
          fields: Object.fromEntries(
            ['name', 'municipality', 'region', 'navaidname'].map((field) => [
              field,
              {
                valid: 0,
                missing: 0,
                stale: 0,
                manual: 0,
                pending: 0,
                failed: 0,
                translated: 0,
              },
            ]),
          ),
        },
      ]),
    );
    for (const e of translationWorklist(snapshot, catalog)) {
      locales[e.locale].missing++;
      locales[e.locale].fields[e.field].missing++;
    }
    const sourceFields = { name: 0, municipality: 0, region: 0, navaidname: 0 };
    for (const r of snapshot.records || [])
      for (const field of ['name', 'municipality', 'region'])
        if (r[field]) sourceFields[field]++;
    sourceFields.navaidname = (snapshot.navaids || []).filter(
      (r) => r.name,
    ).length;
    let fields = 0;
    for (const r of snapshot.records || [])
      fields += ['name', 'municipality', 'region'].filter((f) => r[f]).length;
    fields += (snapshot.navaids || []).filter((r) => r.name).length;
    // Existing entries absent from the current valid set are stale or orphaned.
    const records = {
      airport: new Map((snapshot.records || []).map((r) => [String(r.id), r])),
      navaid: new Map((snapshot.navaids || []).map((r) => [String(r.id), r])),
    };
    const { fieldFingerprint } =
      await import('../server/providers/airports/localization.js');
    for (const e of catalog.entries) {
      const r = records[e.kind].get(e.id);
      if (
        !r ||
        !r[e.field === 'navaidname' ? 'name' : e.field] ||
        fieldFingerprint(r, e.field) !== e.fingerprint
      ) {
        locales[e.locale].stale++;
        locales[e.locale].fields[e.field].stale++;
      } else if ((e.provenance?.source || 'manual') === 'manual') {
        locales[e.locale].manual++;
        locales[e.locale].fields[e.field].manual++;
      }
    }
    for (const item of Object.values(locales)) {
      item.valid = fields - item.missing;
      item.translated = item.valid;
      item.pending = item.missing;
      for (const [field, counts] of Object.entries(item.fields)) {
        counts.valid = sourceFields[field] - counts.missing;
        counts.pending = counts.missing;
        counts.translated = counts.valid;
      }
    }
    await emit(
      `${JSON.stringify({ revision: snapshot.revision, english: { source: fields, translated: 0 }, locales }, null, 2)}\n`,
    );
    return;
  }
  if (command === 'export') {
    const limit =
      options.limit === undefined ? Infinity : Number(options.limit);
    if (!(limit >= 0) || (limit !== Infinity && !Number.isInteger(limit)))
      throw Error('Invalid limit');
    let count = 0;
    let handle;
    if (options.output) {
      const { open } = await import('node:fs/promises');
      handle = await open(resolve(options.output), 'w');
    }
    try {
      for (const e of translationWorklist(snapshot, catalog, {
        locale: options.locale,
      })) {
        if (count >= limit) break;
        const line = `${JSON.stringify(e)}\n`;
        if (handle) await handle.write(line);
        else await emit(line);
        count++;
      }
    } finally {
      await handle?.close();
    }
    return;
  }
  if (
    (!options.input && !options.authored) ||
    (options.input && options.authored)
  )
    throw Error('Import requires exactly one --input or --authored file');
  const raw = await readFile(
    resolve(options.input || options.authored),
    'utf8',
  );
  let entries;
  if (options.authored) {
    entries = compileAuthoredTranslations(snapshot, JSON.parse(raw));
  } else
    try {
      const parsed = JSON.parse(raw);
      entries = Array.isArray(parsed) ? parsed : parsed.entries;
    } catch {
      entries = raw
        .split(/\r?\n/)
        .filter((s) => s.trim())
        .map((s) => JSON.parse(s));
    }
  if (!Array.isArray(entries))
    throw Error('Import requires an entries array or NDJSON entries');
  if (options.input)
    entries = entries.map((e) => ({
      ...e,
      provenance: { source: 'manual', ...e.provenance },
    }));
  // Validate the entire batch before creating or changing any language file.
  const merged = mergeTranslations(snapshot, catalog, entries);
  const files = {};
  let changedLocales = 0;
  for (const locale of TRANSLATION_LOCALES) {
    const previous = catalog.entries.filter((e) => e.locale === locale);
    const next = merged.entries.filter((e) => e.locale === locale);
    if (JSON.stringify(previous) !== JSON.stringify(next)) changedLocales++;
    if (!next.length) continue;
    const data = `${JSON.stringify({ schemaVersion: 1, locale, entries: next }, null, 2)}\n`;
    const hash = createHash('sha256').update(data).digest('hex');
    const filename = `${locale}.${hash}.json`;
    const path = join(directory, filename);
    try {
      const existing = await readFile(path);
      if (createHash('sha256').update(existing).digest('hex') !== hash)
        throw Error('Corrupt immutable translation file');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const temporary = `${path}.${process.pid}.tmp`;
      try {
        await durableWrite(temporary, data);
        await rename(temporary, path);
      } finally {
        await unlink(temporary).catch(() => {});
      }
    }
    files[locale] = filename;
  }
  if (changedLocales) {
    const manifestPath = join(directory, 'manifest.json');
    const temporary = `${manifestPath}.${process.pid}.tmp`;
    try {
      await durableWrite(
        temporary,
        `${JSON.stringify({ schemaVersion: 1, files }, null, 2)}\n`,
      );
      await rename(temporary, manifestPath);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  await emit(
    `${JSON.stringify({ imported: entries.length, changedLocales })}\n`,
  );
}
main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await releaseLock?.();
  });
