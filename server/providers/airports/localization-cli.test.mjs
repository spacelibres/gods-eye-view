import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fieldFingerprint } from './localization.js';
test('CLI reports honest coverage, imports incrementally, rejects stale batches and exports NDJSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'airport-translations-'));
  try {
    const r = { id: '1', ident: 'ABC', name: 'Airport', countryCode: 'US' };
    const snapshot = join(dir, 'snapshot.json');
    await writeFile(snapshot, JSON.stringify({ records: [r], navaids: [] }));
    const catalogs = join(dir, 'translations');
    const run = (...args) =>
      execFileSync(
        process.execPath,
        [
          'scripts/airport-translations.mjs',
          ...args,
          '--snapshot',
          snapshot,
          '--catalog',
          catalogs,
        ],
        { encoding: 'utf8' },
      );
    assert.equal(JSON.parse(run('report')).locales['zh-CN'].missing, 1);
    assert.equal(
      JSON.parse(run('report')).locales['zh-CN'].fields.name.missing,
      1,
    );
    const input = join(dir, 'input.json');
    const entry = {
      kind: 'airport',
      id: '1',
      field: 'name',
      locale: 'zh-CN',
      fingerprint: fieldFingerprint(r, 'name'),
      text: '机场',
    };
    await writeFile(input, JSON.stringify([entry]));
    run('import', '--input', input);
    const manifestPath = join(catalogs, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const file = join(catalogs, manifest.files['zh-CN']);
    const before = await readFile(file, 'utf8');
    const modified = (await stat(file)).mtimeMs;
    run('import', '--input', input);
    assert.equal((await stat(file)).mtimeMs, modified);
    assert.equal(JSON.parse(run('report')).locales['zh-CN'].valid, 1);
    assert.equal(JSON.parse(run('report')).locales['zh-CN'].manual, 1);
    assert.equal(JSON.parse(run('report')).locales['zh-CN'].failed, 0);
    assert.equal(
      JSON.parse(run('report')).locales['zh-CN'].fields.name.manual,
      1,
    );
    assert.equal(
      JSON.parse(run('report')).locales['zh-CN'].fields.name.pending,
      0,
    );
    assert.equal(
      JSON.parse(run('report')).locales['zh-CN'].fields.name.failed,
      0,
    );
    const authored = join(dir, 'authored.json');
    await writeFile(
      authored,
      JSON.stringify([
        { ident: 'ABC', sourceName: 'Airport', name: { ja: '空港' } },
      ]),
    );
    assert.equal(
      JSON.parse(run('import', '--authored', authored)).changedLocales,
      1,
    );
    assert.equal(JSON.parse(run('report')).locales.ja.valid, 1);
    await writeFile(
      input,
      JSON.stringify([
        { ...entry, text: '新机场' },
        { ...entry, locale: 'ja', fingerprint: 'a'.repeat(64) },
      ]),
    );
    assert.throws(() => run('import', '--input', input));
    assert.equal(await readFile(file, 'utf8'), before);
    const exported = run('export', '--locale', 'ko', '--limit', '1').trim();
    assert.equal(JSON.parse(exported).source, 'Airport');
    await writeFile(file, before.replace('机场', '篡改'));
    assert.throws(() => run('report'));
    await writeFile(file, before);
    await writeFile(join(catalogs, '.import.lock'), 'busy');
    assert.throws(() => run('import', '--input', input));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
