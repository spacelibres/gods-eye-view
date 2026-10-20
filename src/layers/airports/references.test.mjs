import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatNavaidFrequency,
  countryLabelPoint,
  navaidDetailRows,
  navaidSymbol,
} from './references.js';
test('frequency preserves NDB kHz and converts VOR source kHz to MHz', () => {
  assert.equal(formatNavaidFrequency(385, 'NDB'), '385 kHz');
  assert.equal(formatNavaidFrequency(113600, 'VOR-DME'), '113.6 MHz');
  assert.equal(formatNavaidFrequency(null, 'VOR'), null);
});
test('country representative point unwraps dateline', () => {
  const p = countryLabelPoint({ polygons: [[[179, 0, 2, 0, 0, 2, -2, 0]]] }, 0);
  assert.ok(Math.abs(p.lon) > 170);
  assert.ok(p.lat >= 0 && p.lat <= 2);
});
test('navaid details preserve DME frequency and MSL metadata safely', () => {
  const rows = navaidDetailRows(
    {
      id: 1,
      name: 'A',
      type: 'NDB',
      frequencyKhz: 385,
      dmeFrequencyKhz: 110300,
      elevationM: 200,
    },
    { source: 'OurAirports' },
  );
  assert.ok(rows.some(([k, v]) => k === 'Frequency' && v === '385 kHz'));
  assert.ok(rows.some(([k, v]) => k === 'DME frequency' && v === '110.3 MHz'));
  assert.ok(rows.some(([k, v]) => k === 'Elevation (m MSL)' && v === 200));
  assert.notEqual(navaidSymbol('NDB'), navaidSymbol('VOR'));
  assert.notEqual(navaidSymbol('DME'), navaidSymbol('VOR'));
});

import * as Cesium from 'cesium';
import { createAviationReferences } from './references.js';
function fixture(source, extra = {}) {
  const entries = new Map(),
    contexts = new Map();
  const viewer = {
    dataSources: { add() {}, remove() {} },
    scene: {
      requestRender() {},
      globe: {
        getHeight() {
          return 14;
        },
      },
    },
  };
  const layer = createAviationReferences({
    source,
    overlayHost: {
      setVisible() {},
      setEntries(id, v) {
        entries.set(id, v);
      },
      clearSource(id) {
        entries.delete(id);
      },
    },
    registerEntityContext(e, c) {
      contexts.set(c.id, c);
    },
    removeEntityContextsForLayer(id, opts) {
      for (const [key, c] of contexts)
        if (c.layerId === id && !opts?.retainIds.has(key)) contexts.delete(key);
    },
    ...extra,
  });
  layer.init(viewer);
  layer.enable();
  return { layer, viewer, entries, contexts };
}
test('navaids are bounded station billboards, MSL metadata and safe detail HTML; failure preserves good state', async () => {
  let fail = false;
  const a = {
    id: '42',
    name: '<Radio>',
    type: 'VOR-DME',
    ident: 'ABC',
    lat: 1,
    lon: 2,
    elevationM: 900,
    frequencyKhz: 113600,
  };
  const f = fixture({
    async getNavaids() {
      if (fail) throw Error('offline');
      return { navaids: [a], revision: 'r1' };
    },
  });
  await f.layer.update({ height: 10000 });
  assert.equal(f.layer.getStats().navaidCount, 1);
  assert.equal(f.contexts.get('navaid:42').properties.elevationM, 900);
  fail = true;
  await f.layer.update({ height: 10000 });
  assert.equal(f.layer.getStats().navaidCount, 1);
  assert.equal(f.layer.getStats().referenceError, 'offline');
  await f.layer.update({ height: 900000 });
  assert.equal(f.layer.getStats().navaidCount, 0);
  f.layer.destroy();
  assert.equal(f.contexts.size, 0);
});
test('country names localize lazily, are bounded, and stale country data cannot publish after disable', async () => {
  let loads = 0;
  const f = fixture(
    {
      async getCountries() {
        return { countries: [{ code: 'FR', name: 'France' }] };
      },
    },
    {
      getLocale: () => 'zh-CN',
      loadCountries: async () => {
        loads++;
        return {
          meta: { decimals: 0 },
          features: [
            {
              iso2: 'FR',
              name: 'France',
              polygons: [[[0, 0, 4, 0, 0, 4, -4, 0]]],
            },
          ],
        };
      },
    },
  );
  await f.layer.update({ height: 10000 });
  assert.equal(loads, 0);
  await f.layer.update({ height: 900000 });
  assert.equal(loads, 1);
  assert.equal(f.layer.getStats().countryCount, 1);
  assert.equal(f.entries.get('airports-country-labels')[0].title, '法国');
  f.layer.destroy();
  assert.equal(f.entries.size, 0);
  let finish;
  const g = fixture({
    getNavaids: () =>
      new Promise((r) => {
        finish = r;
      }),
  });
  const p = g.layer.update({ height: 10 });
  g.layer.disable();
  finish({ navaids: [{ id: 1, lat: 0, lon: 0 }] });
  assert.equal(await p, false);
  assert.equal(g.layer.getStats().navaidCount, 0);
  g.layer.destroy();
});
test('country anchor chooses largest polygon explicitly', () => {
  const p = countryLabelPoint(
    {
      polygons: [[[0, 0, 1, 0, 0, 1, -1, 0]], [[20, 20, 10, 0, 0, 10, -10, 0]]],
    },
    0,
  );
  assert.equal(p.lon, 25);
  assert.equal(p.lat, 25);
});
test('navaid cap metadata and last good metadata survive source failure', async () => {
  let fail = false;
  const f = fixture({
    async getNavaids() {
      if (fail) throw Error('offline');
      return {
        navaids: Array.from({ length: 605 }, (_, id) => ({
          id,
          type: 'VOR',
          lat: 0,
          lon: 0,
        })),
        total: 11000,
        matched: 605,
        truncated: true,
      };
    },
  });
  await f.layer.update({ height: 10 });
  assert.equal(f.layer.getStats().navaidCount, 600);
  assert.equal(f.layer.getStats().navaidMatched, 605);
  assert.equal(f.layer.getStats().navaidTruncated, true);
  fail = true;
  await f.layer.update({ height: 10 });
  assert.equal(f.layer.getStats().navaidMatched, 605);
  assert.equal(f.layer.getStats().referenceError, 'offline');
  f.layer.destroy();
});
