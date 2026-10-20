import { mkdir, writeFile } from 'node:fs/promises';
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
  now: () => timestamp,
  signal: AbortSignal.timeout(60000),
});
const destination = resolve('server/data/airports');
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
