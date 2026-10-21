import { AIRPORT_SOURCE_FILES } from '../server/providers/airports/archive.js';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { downloadSnapshot } from '../server/providers/airports/collector.js';
const revision = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(revision || ''))
  throw Error(
    'Usage: node scripts/import-airports.mjs <40-character pinned git revision> [retrievedAt ISO]',
  );
const timestamp = process.argv[3] ? Date.parse(process.argv[3]) : Date.now();
if (!Number.isFinite(timestamp)) throw Error('Invalid retrieval timestamp');
const result = await downloadSnapshot({
  revision,
  fetchImpl: process.env.GEV_AIRPORTS_IMPORT_DIR
    ? async (url) => {
        const name = new URL(url).pathname.split('/').pop();
        if (!AIRPORT_SOURCE_FILES.includes(name))
          throw Error('Invalid offline source file');
        return new Response(
          await readFile(resolve(process.env.GEV_AIRPORTS_IMPORT_DIR, name)),
        );
      }
    : undefined,
  now: () => timestamp,
  signal: AbortSignal.timeout(60000),
});
const destination = resolve('server/data/airports');
await mkdir(resolve(destination, 'raw'), { recursive: true });
for (const [name, body] of Object.entries(result.files))
  await writeFile(resolve(destination, 'raw', name), body);
await mkdir(destination, { recursive: true });
for (const key of ['snapshot', 'provenance'])
  await writeFile(
    resolve(destination, key + '.json'),
    JSON.stringify(result[key]) + '\n',
  );
console.log(
  JSON.stringify({
    revision,
    records: result.snapshot.records.length,
    ...result.provenance,
  }),
);
