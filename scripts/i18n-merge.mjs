#!/usr/bin/env node
// Merge a fragment into a locale catalog, keeping every existing entry.
//
//   node scripts/i18n-merge.mjs <locale> <fragment.json>
//
// The fragment holds only the entries written in this pass; nothing already
// in the catalog is dropped. A key present in both wins with the fragment's
// value, so a fix can be applied by re-listing just that key.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const [locale, fragmentPath] = process.argv.slice(2);
if (!locale || !fragmentPath) {
  console.error('usage: node scripts/i18n-merge.mjs <locale> <fragment.json>');
  process.exit(2);
}

const catalogFile = path.join(ROOT, 'src/i18n/locales', `${locale}.json`);
const catalog = existsSync(catalogFile)
  ? JSON.parse(readFileSync(catalogFile, 'utf8'))
  : {};
const fragment = JSON.parse(readFileSync(fragmentPath, 'utf8'));
const before = Object.keys(catalog).length;
Object.assign(catalog, fragment);
writeFileSync(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(
  `${locale}: ${before} → ${Object.keys(catalog).length} entries (+${Object.keys(catalog).length - before})`,
);
