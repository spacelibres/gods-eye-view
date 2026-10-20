import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAirportCollector, readBoundedResponse } from './collector.js';
const record = {
  id: '1',
  ident: 'X',
  name: 'Airport',
  type: 'large_airport',
  lat: 1,
  lon: 1,
  elevationM: null,
  countryCode: 'NA',
  country: 'Namibia',
  regionCode: '',
  region: '',
  municipality: '',
  icaoCode: '',
  iataCode: '',
  gpsCode: '',
  localCode: '',
  scheduledService: false,
  keywords: '',
  website: '',
  wikipedia: '',
};
const snapshot = {
  schemaVersion: 1,
  revision: 'a'.repeat(40),
  updatedAt: '2026-10-21T00:00:00Z',
  source: 'OurAirports',
  sourceUrl: 'https://ourairports.com/data/',
  records: [record],
};
test('daily reservation survives failure, restart and peer reads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'airports-'));
  let calls = 0;
  const opts = {
    stateDir: dir,
    bundledSnapshot: snapshot,
    now: () => Date.parse(snapshot.updatedAt) + 86400001,
    loadSnapshot: async () => {
      calls++;
      throw Error('offline');
    },
    production: false,
  };
  try {
    const a = createAirportCollector(opts);
    await a.ready;
    await a.refresh();
    assert.equal(calls, 1);
    assert.equal(a.getSnapshot().records.length, 1);
    const b = createAirportCollector(opts);
    await b.ready;
    await b.refresh();
    assert.equal(calls, 1);
    assert.ok(
      JSON.parse(await readFile(join(dir, 'state.json'))).nextCheckAt >=
        Date.parse(snapshot.updatedAt) + 172800001,
    );
    await a.close();
    await b.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('successful publication is persistent and peer sees it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'airports-'));
  try {
    const opts = {
      stateDir: dir,
      bundledSnapshot: snapshot,
      now: () => Date.parse(snapshot.updatedAt) + 86400001,
      production: false,
      loadSnapshot: async () => ({ ...snapshot, revision: 'b'.repeat(40) }),
    };
    const a = createAirportCollector(opts);
    await a.ready;
    await a.refresh();
    const b = createAirportCollector(opts);
    await b.ready;
    assert.equal(b.getSnapshot().revision, 'b'.repeat(40));
    await a.close();
    await b.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('corrupt durable state postpones collection instead of opening budget', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'airports-'));
  let calls = 0;
  try {
    await writeFile(join(dir, 'state.json'), 'bad');
    const c = createAirportCollector({
      stateDir: dir,
      bundledSnapshot: snapshot,
      production: false,
      now: () => 1000,
      loadSnapshot: async () => {
        calls++;
        return snapshot;
      },
    });
    await c.ready;
    await c.refresh();
    assert.equal(calls, 0);
    await c.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('bounded reader rejects oversized response without consuming endless cancel', async () => {
  let canceled = false;
  const response = new Response(
    new ReadableStream({
      pull(c) {
        c.enqueue(new Uint8Array(100));
      },
      cancel() {
        canceled = true;
        return new Promise(() => {});
      },
    }),
  );
  await assert.rejects(
    readBoundedResponse(response, { maxBytes: 10 }),
    /large/,
  );
  assert.equal(canceled, true);
});
test('stalled response body is interrupted by abort', async () => {
  const controller = new AbortController();
  const response = new Response(
    new ReadableStream({
      pull() {
        return new Promise(() => {});
      },
      cancel() {
        return new Promise(() => {});
      },
    }),
  );
  const pending = readBoundedResponse(response, { signal: controller.signal });
  controller.abort(Error('deadline'));
  await assert.rejects(pending, /deadline/);
});
test('concurrent workers acquire upstream only once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'airports-'));
  let calls = 0;
  try {
    const opts = {
      stateDir: dir,
      bundledSnapshot: snapshot,
      production: false,
      now: () => Date.parse(snapshot.updatedAt) + 86400001,
      loadSnapshot: async () => {
        calls++;
        return snapshot;
      },
    };
    const a = createAirportCollector(opts),
      b = createAirportCollector(opts);
    await Promise.all([a.ready, b.ready]);
    await Promise.all([a.refresh(), b.refresh()]);
    assert.equal(calls, 1);
    await a.close();
    await b.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('HTTP Retry-After date is durable and bad updates keep last-good records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'airports-'));
  const time = Date.parse(snapshot.updatedAt) + 86400001;
  const retry = time + 5 * 86400000;
  try {
    const a = createAirportCollector({
      stateDir: dir,
      bundledSnapshot: snapshot,
      production: false,
      now: () => time,
      loadSnapshot: async () => {
        throw Object.assign(Error('HTTP 429'), { retryAt: retry });
      },
    });
    await a.ready;
    await a.refresh();
    assert.equal(a.getState().nextCheckAt, retry);
    assert.equal(a.getSnapshot().revision, snapshot.revision);
    await a.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('production references require complete tables and resolved airport references', async () => {
  const { validateAirportReferences } = await import('./model.js');
  assert.equal(typeof validateAirportReferences, 'function');
  assert.throws(
    () =>
      validateAirportReferences('code,name\n', 'code,name\n', snapshot.records),
    /reference/i,
  );
  const countries =
    'code,name\n' +
    Array.from({ length: 200 }, (_, i) => `C${i},Country${i}`).join('\n');
  const regions =
    'code,name\n' +
    Array.from({ length: 1000 }, (_, i) => `R${i},Region${i}`).join('\n');
  assert.throws(
    () => validateAirportReferences(countries, regions, snapshot.records),
    /reference/i,
  );
});
test('one atomic envelope retains provenance on failed replacement', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'airports-'));
  let time = Date.parse(snapshot.updatedAt) + 86400001;
  let fail = false;
  const { rename } = await import('node:fs/promises');
  try {
    const c = createAirportCollector({
      stateDir: dir,
      bundledSnapshot: snapshot,
      production: false,
      now: () => time,
      renameImpl: async (a, b) => {
        if (fail && b.endsWith('directory.json')) throw Error('disk failure');
        return rename(a, b);
      },
      loadSnapshot: async () => ({
        ...snapshot,
        revision: (fail ? 'c' : 'b').repeat(40),
      }),
    });
    await c.ready;
    await c.refresh();
    const before = await readFile(join(dir, 'directory.json'), 'utf8');
    assert.equal(JSON.parse(before).snapshot.revision, 'b'.repeat(40));
    fail = true;
    time += 86400001;
    await c.refresh();
    assert.equal(await readFile(join(dir, 'directory.json'), 'utf8'), before);
    assert.equal(c.getSnapshot().revision, 'b'.repeat(40));
    await c.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('peer starting during reservation sees later publication without upstream reads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'airports-'));
  let release;
  const wait = new Promise((resolve) => (release = resolve));
  let acquired;
  const began = new Promise((resolve) => (acquired = resolve));
  let calls = 0;
  const opts = {
    stateDir: dir,
    bundledSnapshot: snapshot,
    production: false,
    now: () => Date.parse(snapshot.updatedAt) + 86400001,
  };
  try {
    const a = createAirportCollector({
      ...opts,
      loadSnapshot: async () => {
        calls++;
        acquired();
        await wait;
        return { ...snapshot, revision: 'b'.repeat(40) };
      },
    });
    await a.ready;
    const pending = a.refresh();
    await began;
    const b = createAirportCollector({
      ...opts,
      loadSnapshot: async () => {
        throw Error('must remain cache only');
      },
    });
    await b.ready;
    assert.equal(b.getSnapshot().revision, snapshot.revision);
    release();
    await pending;
    assert.equal((await b.readSnapshot()).revision, 'b'.repeat(40));
    assert.equal(calls, 1);
    await a.close();
    await b.close();
  } finally {
    release();
    await rm(dir, { recursive: true, force: true });
  }
});
test(
  'POSIX persistence uses private directory and files',
  { skip: process.platform === 'win32' },
  async () => {
    const parent = await mkdtemp(join(tmpdir(), 'airports-'));
    const dir = join(parent, 'private');
    try {
      const { stat } = await import('node:fs/promises');
      const c = createAirportCollector({
        stateDir: dir,
        bundledSnapshot: snapshot,
        production: false,
        now: () => Date.parse(snapshot.updatedAt) + 86400001,
        loadSnapshot: async () => snapshot,
      });
      await c.ready;
      await c.refresh();
      assert.equal((await stat(dir)).mode & 0o777, 0o700);
      for (const name of ['state.json', 'directory.json'])
        assert.equal((await stat(join(dir, name))).mode & 0o777, 0o600);
      await c.close();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  },
);
test('production download rejects header-only references before replacing last-good envelope', async () => {
  const { downloadSnapshot } = await import('./collector.js');
  const dir = await mkdtemp(join(tmpdir(), 'airports-'));
  let time = Date.parse(snapshot.updatedAt) + 86400001;
  let bad = false;
  const header =
    'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,iso_country,iso_region,municipality,scheduled_service,icao_code,iata_code,gps_code,local_code,home_link,wikipedia_link,keywords';
  const airports =
    header +
    '\n' +
    Array.from(
      { length: 50000 },
      (_, i) =>
        `${i + 1},X${i},large_airport,Airport${i},1,1,,C${i % 200},R${i % 1000},,no,,,,,,,`,
    ).join('\n');
  const fetchImpl = async (url) =>
    new Response(url.endsWith('airports.csv') ? airports : 'code,name\n');
  try {
    const c = createAirportCollector({
      stateDir: dir,
      bundledSnapshot: snapshot,
      production: false,
      now: () => time,
      loadSnapshot: () =>
        bad
          ? downloadSnapshot({
              revision: 'b'.repeat(40),
              fetchImpl,
              now: () => time,
            })
          : snapshot,
    });
    await c.ready;
    await c.refresh();
    const before = await readFile(join(dir, 'directory.json'), 'utf8');
    bad = true;
    time += 86400001;
    await c.refresh();
    assert.equal(await readFile(join(dir, 'directory.json'), 'utf8'), before);
    assert.equal(c.getSnapshot().revision, snapshot.revision);
    await assert.rejects(
      downloadSnapshot({
        revision: 'b'.repeat(40),
        fetchImpl,
        now: () => time,
      }),
      /reference/i,
    );
    await c.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
