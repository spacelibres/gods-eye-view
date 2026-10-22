import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('authored names bind identities and reuse city/region only within their context', async () => {
  const { compileAuthoredTranslations } =
    await import('./authoredTranslations.js');
  const record = {
    id: '1',
    ident: 'QA',
    name: 'Airport',
    municipality: 'City',
    region: 'Region',
    countryCode: 'GB',
    regionCode: 'GB-X',
  };
  const snapshot = {
    records: [
      record,
      { ...record, id: '2', ident: 'QB', name: 'Other' },
      { ...record, id: '3', ident: 'QC', countryCode: 'US' },
    ],
  };
  const authored = [
    {
      ident: 'QA',
      sourceName: 'Airport',
      name: { ja: '空港' },
      sourceMunicipality: 'City',
      municipality: { ja: '都市' },
      sourceRegion: 'Region',
      region: { ja: '地域' },
    },
  ];
  const entries = compileAuthoredTranslations(snapshot, authored);
  assert.equal(entries.length, 5);
  assert.equal(
    entries.find((e) => e.id === '2' && e.field === 'municipality').text,
    '都市',
  );
  assert.ok(!entries.some((e) => e.id === '3'));
  assert.throws(
    () =>
      compileAuthoredTranslations(snapshot, [
        { ...authored[0], sourceName: 'Stale' },
      ]),
    /source/i,
  );
});

test('bundled authored translations match actual source identities and every shipped target language', async () => {
  const { compileAuthoredTranslations } =
    await import('./authoredTranslations.js');
  const { TRANSLATION_LOCALES, mergeTranslations } =
    await import('./localization.js');
  const snapshot = JSON.parse(
    await readFile(
      new URL('../../data/airports/snapshot.json', import.meta.url),
      'utf8',
    ),
  );
  const authored = JSON.parse(
    await readFile(
      new URL(
        '../../data/airports/translations/authored.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.equal(new Set(authored.map((a) => a.ident)).size, authored.length);
  for (const item of authored)
    for (const field of ['name', 'municipality', 'region'])
      assert.deepEqual(
        Object.keys(item[field]).sort(),
        [...TRANSLATION_LOCALES].sort(),
      );
  const entries = compileAuthoredTranslations(snapshot, authored);
  assert.equal(
    mergeTranslations(snapshot, { entries: [] }, entries).entries.length,
    entries.length,
  );
  assert.equal(
    entries.filter((e) => e.field === 'name').length,
    authored.length * 6,
  );
});
