import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('durable pending list groups locales and skips unchanged source/catalog', async () => {
  const { writePendingTranslations } =
    await import('./translationMaintenance.js');
  const directory = await mkdtemp(join(tmpdir(), 'gev-pending-translations-'));
  const snapshot = {
    revision: 'a',
    records: [
      {
        id: '1',
        ident: 'QA',
        name: 'Example Airport',
        municipality: '',
        region: '',
        countryCode: 'GB',
      },
    ],
  };
  const catalog = { schemaVersion: 1, entries: [] };
  try {
    assert.equal(
      await writePendingTranslations(snapshot, catalog, directory),
      true,
    );
    const lines = (await readFile(join(directory, 'pending.ndjson'), 'utf8'))
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.equal(lines.length, 2);
    assert.equal(lines[1].source, 'Example Airport');
    assert.equal(lines[1].locales.length, 6);
    const before = (await stat(join(directory, 'pending.ndjson'))).mtimeMs;
    assert.equal(
      await writePendingTranslations(snapshot, catalog, directory),
      false,
    );
    assert.equal(
      (await stat(join(directory, 'pending.ndjson'))).mtimeMs,
      before,
    );
    assert.equal(
      await writePendingTranslations(
        {
          ...snapshot,
          revision: 'b',
          records: [{ ...snapshot.records[0], name: 'Renamed Airport' }],
        },
        catalog,
        directory,
      ),
      true,
    );
    assert.match(
      await readFile(join(directory, 'pending.ndjson'), 'utf8'),
      /Renamed Airport/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('concurrent pending writers publish one complete file', async () => {
  const { writePendingTranslations } =
    await import('./translationMaintenance.js');
  const directory = await mkdtemp(join(tmpdir(), 'gev-pending-workers-'));
  try {
    const snapshot = { revision: 'a', records: [{ id: '1', name: 'Airport' }] };
    const results = await Promise.all(
      [1, 2].map(() =>
        writePendingTranslations(snapshot, { entries: [] }, directory),
      ),
    );
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(
      (await readFile(join(directory, 'pending.ndjson'), 'utf8'))
        .trim()
        .split('\n').length,
      2,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
