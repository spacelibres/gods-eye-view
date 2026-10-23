import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fieldFingerprint,
  localizeSnapshot,
  translationWorklist,
  mergeTranslations,
} from './localization.js';
const record = {
  id: '1',
  ident: 'TEST',
  name: 'Test Airport',
  municipality: 'Town',
  region: 'Region',
  countryCode: 'US',
  regionCode: 'US-T',
  keywords: 'Old Field',
  lat: 1,
  lon: 2,
};
const snapshot = { revision: 'one', records: [record], navaids: [] };
const entry = (field = 'name', text = '测试机场') => ({
  kind: 'airport',
  id: '1',
  field,
  locale: 'zh-CN',
  fingerprint: fieldFingerprint(record, field),
  text,
});
test('fingerprints ignore coordinates and other translated fields but bind geographic identity', () => {
  assert.equal(
    fieldFingerprint(record, 'name'),
    fieldFingerprint({ ...record, lat: 9, municipality: 'New' }, 'name'),
  );
  assert.notEqual(
    fieldFingerprint(record, 'name'),
    fieldFingerprint({ ...record, countryCode: 'CA' }, 'name'),
  );
});
test('worklists invalidate only changed fields and ignore revision and coordinates', () => {
  const catalog = mergeTranslations(snapshot, { entries: [] }, [
    entry(),
    entry('municipality', '城镇'),
  ]);
  const missing = (s) =>
    [...translationWorklist(s, catalog)].filter((e) => e.locale === 'zh-CN');
  assert.deepEqual(
    missing({
      ...snapshot,
      revision: 'two',
      records: [{ ...record, lat: 9 }],
    }).map((e) => e.field),
    ['region'],
  );
  assert.deepEqual(
    missing({ ...snapshot, records: [{ ...record, name: 'Renamed' }] }).map(
      (e) => e.field,
    ),
    ['name', 'region'],
  );
});
test('imports validate atomically, reject stale entries and are idempotent', () => {
  const base = { schemaVersion: 1, entries: [] };
  assert.throws(() =>
    mergeTranslations(snapshot, base, [
      entry(),
      { ...entry('municipality', '城镇'), fingerprint: 'stale' },
    ]),
  );
  assert.deepEqual(base.entries, []);
  const once = mergeTranslations(snapshot, base, [entry()]);
  assert.deepEqual(mergeTranslations(snapshot, once, [entry()]), once);
});
test('projection preserves source aliases, is immutable and cached', () => {
  const c = mergeTranslations(snapshot, { entries: [] }, [entry()]);
  const translated = localizeSnapshot(snapshot, c, 'zh-CN');
  assert.equal(translated.records[0].name, '测试机场');
  assert.equal(translated.records[0].originalName, record.name);
  assert.match(translated.records[0].keywords, /Old Field/);
  assert.match(translated.records[0].keywords, /Test Airport/);
  assert.equal(record.name, 'Test Airport');
  assert.equal(localizeSnapshot(snapshot, c, 'zh-CN'), translated);
  assert.ok(Object.isFrozen(translated.records[0]));
  assert.equal(localizeSnapshot(snapshot, c, 'en'), snapshot);
});
test('untranslated records retain identity without allocating projections', () => {
  const translated = localizeSnapshot(snapshot, { entries: [] }, 'ja');
  assert.equal(translated.records[0], record);
});

test('projection cache keeps the most recently used locales only', () => {
  const catalog = mergeTranslations(snapshot, { entries: [] }, [
    entry(),
    { ...entry(), locale: 'ja', text: 'テスト空港' },
    { ...entry(), locale: 'ko', text: '테스트 공항' },
  ]);
  const zh = localizeSnapshot(snapshot, catalog, 'zh-CN');
  const ja = localizeSnapshot(snapshot, catalog, 'ja');
  assert.equal(zh.records[0].name, '测试机场');
  assert.equal(ja.records[0].name, 'テスト空港');

  // Touch zh-CN so ja-CN drops to least recently used, then add a third locale.
  assert.equal(localizeSnapshot(snapshot, catalog, 'zh-CN'), zh);
  localizeSnapshot(snapshot, catalog, 'ko');
  assert.equal(localizeSnapshot(snapshot, catalog, 'zh-CN'), zh);
  // The evicted projection is rebuilt, so it is a new but equivalent object.
  const rebuilt = localizeSnapshot(snapshot, catalog, 'ja');
  assert.notEqual(rebuilt, ja);
  assert.equal(rebuilt.records[0].name, 'テスト空港');
});

test('changing another language does not change this language revision', () => {
  const c = mergeTranslations(snapshot, { entries: [] }, [entry()]);
  const before = localizeSnapshot(snapshot, c, 'zh-CN').translationRevision;
  const next = mergeTranslations(snapshot, c, [
    { ...entry(), locale: 'ja', text: '空港' },
  ]);
  assert.equal(
    localizeSnapshot(snapshot, next, 'zh-CN').translationRevision,
    before,
  );
});
test('translation revisions identify catalog contents and oversized translations fail', () => {
  const c = mergeTranslations(snapshot, { entries: [] }, [entry()]);
  assert.match(c.translationRevision, /^[a-f0-9]{64}$/);
  assert.equal(
    localizeSnapshot(snapshot, c, 'zh-CN').translationRevision,
    c.translationRevision,
  );
  assert.throws(() =>
    mergeTranslations(snapshot, c, [entry('name', 'a'.repeat(2001))]),
  );
});
test('navaid translation maps navaidname and preserves the original name', () => {
  const n = { id: '2', ident: 'NAV', name: 'Beacon', countryCode: 'US' };
  const s = { records: [], navaids: [n] };
  const c = mergeTranslations(s, { entries: [] }, [
    {
      kind: 'navaid',
      id: '2',
      field: 'navaidname',
      locale: 'ja',
      fingerprint: fieldFingerprint(n, 'navaidname'),
      text: 'ビーコン',
    },
  ]);
  const p = localizeSnapshot(s, c, 'ja');
  assert.equal(p.navaids[0].name, 'ビーコン');
  assert.equal(p.navaids[0].originalName, 'Beacon');
  assert.throws(() =>
    mergeTranslations(s, c, [
      {
        kind: 'navaid',
        id: '2',
        field: 'name',
        locale: 'ja',
        fingerprint: fieldFingerprint(n, 'name'),
        text: 'ビーコン',
      },
    ]),
  );
});
test('manual translations survive authored imports and manual corrections retain audit metadata', () => {
  const original = mergeTranslations(snapshot, { entries: [] }, [entry()]);
  assert.equal(original.entries[0].provenance.source, 'manual');
  assert.equal(original.entries[0].standardVersion, 1);
  assert.equal(original.entries[0].status, 'translated');
  assert.ok(Number.isFinite(Date.parse(original.entries[0].updatedAt)));
  assert.throws(
    () =>
      mergeTranslations(snapshot, original, [
        {
          ...entry('name', '自动翻译'),
          provenance: { source: 'project-authored' },
        },
      ]),
    /manual/i,
  );
  const corrected = mergeTranslations(snapshot, original, [
    { ...entry('name', '修正机场'), provenance: { source: 'manual' } },
  ]);
  assert.equal(corrected.entries[0].history.at(-1).text, '测试机场');
  assert.equal(
    corrected.entries[0].history.at(-1).fingerprint,
    original.entries[0].fingerprint,
  );
  assert.equal(
    corrected.entries[0].history.at(-1).updatedAt,
    original.entries[0].updatedAt,
  );
  assert.deepEqual(
    mergeTranslations(snapshot, corrected, [entry('name', '修正机场')]),
    corrected,
  );
});
test('pending and failed translations cannot enter active catalogs', () => {
  for (const status of ['pending', 'failed']) {
    assert.throws(
      () =>
        mergeTranslations(snapshot, { entries: [] }, [{ ...entry(), status }]),
      /translation/i,
    );
    assert.throws(
      () =>
        localizeSnapshot(
          snapshot,
          { entries: [{ ...entry(), status }] },
          'zh-CN',
        ),
      /translation/i,
    );
  }
});
test('explicit manual provenance promotes authored text idempotently and prevents later automatic overwrite', () => {
  const authored = mergeTranslations(snapshot, { entries: [] }, [
    {
      ...entry(),
      provenance: { source: 'project-authored' },
      updatedAt: '2026-10-21T00:00:00Z',
    },
  ]);
  const manual = mergeTranslations(snapshot, authored, [
    { ...entry(), provenance: { source: 'manual' } },
  ]);
  assert.equal(manual.entries[0].provenance.source, 'manual');
  assert.equal(manual.entries[0].history.length, 1);
  assert.equal(
    manual.entries[0].history[0].provenance.source,
    'project-authored',
  );
  assert.deepEqual(
    mergeTranslations(snapshot, manual, [
      { ...entry(), provenance: { source: 'manual' } },
    ]),
    manual,
  );
  assert.throws(
    () =>
      mergeTranslations(snapshot, manual, [
        {
          ...entry('name', '新自动翻译'),
          provenance: { source: 'project-authored' },
        },
      ]),
    /Manual translation conflict/,
  );
});
