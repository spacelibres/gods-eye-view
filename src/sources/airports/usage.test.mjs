import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { resolveAirportUsage } from './usage.js';
const edwards = {
  icaoCode: 'KEDW',
  lat: 34.910781,
  lon: -117.886391,
  wikipedia: 'https://en.wikipedia.org/wiki/Edwards_Air_Force_Base',
};

test('importer rejects missing, malformed and undersized bulk evidence without overwriting output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'airport-usage-import-'));
  try {
    const output = join(dir, 'src/sources/airports/usage-data.json');
    mkdirSync(join(dir, 'src/sources/airports'), { recursive: true });
    writeFileSync(output, 'sentinel');
    writeFileSync(join(dir, 'bad.json'), '{');
    writeFileSync(
      join(dir, 'small.json'),
      JSON.stringify({ results: { bindings: [] } }),
    );
    const env = { ...process.env };
    delete env.AIRPORT_USAGE_AUDIT;
    delete env.AIRPORT_USAGE_CHECKED_AT;
    for (const [args, diagnostic] of [
      [[], /bulk response is required/],
      [['bad.json'], /SyntaxError/],
      [['small.json'], /fewer than 500/],
    ]) {
      const child = spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL(
              '../../../scripts/import-airport-usage.mjs',
              import.meta.url,
            ),
          ),
          ...args,
        ],
        { cwd: dir, encoding: 'utf8', env },
      );
      assert.notEqual(child.status, 0);
      assert.match(child.stderr, diagnostic);
      assert.equal(readFileSync(output, 'utf8'), 'sentinel');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('importer audits ended, deprecated, dissolved and active claims and preserves original manual check date', () => {
  const dir = mkdtempSync(join(tmpdir(), 'airport-usage-audit-'));
  try {
    mkdirSync(join(dir, 'src/sources/airports'), { recursive: true });
    const snak = (value) => ({ snaktype: 'value', datavalue: { value } });
    const claim = (value, extra = {}) => ({
      rank: 'normal',
      mainsnak: snak(value),
      ...extra,
    });
    const ended = {
      qualifiers: { P582: [snak({ time: '+2020-01-01T00:00:00Z' })] },
    };
    const entity = () => ({
      claims: {
        P31: [claim({ id: 'Q695850' })],
        P239: [claim('KAAA')],
        P625: [
          claim({
            latitude: 1,
            longitude: 2,
            globe: 'http://www.wikidata.org/entity/Q2',
          }),
        ],
      },
    });
    const audit = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [`Q${i + 1}`, entity()]),
    );
    audit.Q1.claims.P576 = [claim({ time: '+2020-01-01T00:00:00Z' })];
    audit.Q2.claims.P31[0] = claim({ id: 'Q695850' }, ended);
    audit.Q3.claims.P239[0] = claim('KAAA', ended);
    audit.Q4.claims.P31[0].rank = 'deprecated';
    writeFileSync(join(dir, 'audit.json'), JSON.stringify(audit));
    writeFileSync(
      join(dir, 'bulk.json'),
      JSON.stringify({
        results: {
          bindings: Array.from({ length: 500 }, (_, i) => ({
            item: { value: `http://www.wikidata.org/entity/Q${i + 1}` },
            icao: { value: 'KAAA' },
          })),
        },
      }),
    );
    const child = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL('../../../scripts/import-airport-usage.mjs', import.meta.url),
        ),
        'bulk.json',
      ],
      {
        cwd: dir,
        encoding: 'utf8',
        env: {
          ...process.env,
          AIRPORT_USAGE_AUDIT: join(dir, 'audit.json'),
          AIRPORT_USAGE_CHECKED_AT: '2026-10-22',
        },
      },
    );
    assert.equal(child.status, 0, child.stderr);
    const data = JSON.parse(
      readFileSync(join(dir, 'src/sources/airports/usage-data.json'), 'utf8'),
    );
    assert.equal(data.checkedAt, '2026-10-22');
    assert.equal(data.manualEvidence[0].checkedAt, '2026-10-21');
    for (const item of ['Q1', 'Q2', 'Q3', 'Q4'])
      assert.equal(
        data.records.some((row) => row.item === item),
        false,
      );
    assert.deepEqual(
      data.records.find((row) => row.item === 'Q5'),
      {
        icaoCode: 'KAAA',
        kind: 'military',
        item: 'Q5',
        lat: 1,
        lon: 2,
        auditedAt: '2026-10-22',
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unknown is null-safe and never derives military use from names or missing service', () => {
  for (const record of [
    null,
    {},
    { name: 'Army Air Force Military Airport', scheduledService: false },
    { iataCode: 'EDW', gpsCode: 'KEDW' },
  ]) {
    const result = resolveAirportUsage(record);
    assert.equal(result.kind, 'unknown');
    for (const key of ['source', 'sourceUrl', 'checkedAt'])
      assert.equal(typeof result[key], 'string');
    assert.ok(Array.isArray(result.evidence));
  }
});

test('scheduled service confirms civil service without claiming exclusive civil use', () => {
  const result = resolveAirportUsage({ scheduledService: true });
  assert.equal(result.kind, 'civil');
  assert.match(result.evidence.join(' '), /military use is not ruled out/);
});

test('explicit ICAO military evidence overrides misleading name and combines scheduled civil service', () => {
  assert.equal(
    resolveAirportUsage({ ...edwards, name: 'Ordinary Airport' }).kind,
    'military',
  );
  const result = resolveAirportUsage({
    ...edwards,
    scheduledService: true,
  });
  assert.equal(result.kind, 'joint');
  assert.match(result.source, /OurAirports/);
  assert.ok(result.evidence.length >= 2);
});

test('historically reassigned ICAO never assigns the old airbase category to the new airport', () => {
  const result = resolveAirportUsage({
    icaoCode: 'LFSL',
    lat: 45.039722,
    lon: 1.485556,
    scheduledService: true,
  });
  assert.equal(result.kind, 'civil');
});

test('same-location former airbase does not classify the current civilian airport', () => {
  assert.equal(
    resolveAirportUsage({
      icaoCode: 'KMHT',
      lat: 42.9326,
      lon: -71.4357,
      wikipedia:
        'https://en.wikipedia.org/wiki/Manchester%E2%80%93Boston_Regional_Airport',
      scheduledService: true,
    }).kind,
    'civil',
  );
  assert.equal(
    resolveAirportUsage({ ...edwards, wikipedia: '' }).kind,
    'unknown',
  );
  assert.equal(
    resolveAirportUsage({
      ...edwards,
      wikipedia: 'https://en.wikipedia.org/wiki/Unrelated_airport',
    }).kind,
    'unknown',
  );
});

test('matching requires a real ICAO field and handles case safely', () => {
  assert.equal(resolveAirportUsage({ ident: 'KEDW' }).kind, 'unknown');
  assert.equal(
    resolveAirportUsage({ ...edwards, icaoCode: 'kedw' }).kind,
    'military',
  );
  assert.equal(resolveAirportUsage({ icaoCode: 'KEDW' }).kind, 'unknown');
  assert.equal(
    resolveAirportUsage({ ...edwards, lat: 0, lon: 0 }).kind,
    'unknown',
  );
  assert.equal(
    resolveAirportUsage({ icaoCode: ' KEDW extra' }).kind,
    'unknown',
  );
});

test('explicit joint classification wins even without scheduled service', () => {
  assert.equal(
    resolveAirportUsage({
      icaoCode: 'ZBZJ',
      lat: 40.738664,
      lon: 114.933395,
      wikipedia: 'https://en.wikipedia.org/wiki/Zhangjiakou_Ningyuan_Airport',
      scheduledService: false,
    }).kind,
    'joint',
  );
});

test('multiple entities sharing an ICAO code do not establish military identity', () => {
  const result = resolveAirportUsage({
    icaoCode: 'KSKF',
    scheduledService: false,
  });
  assert.equal(result.kind, 'unknown');
  assert.match(result.evidence.join(' '), /ambiguous/);
});
