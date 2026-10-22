import test from 'node:test';
import assert from 'node:assert/strict';
import {
  airportTypesForHeight,
  selectAirports,
  airportContext,
  airportDescription,
  airportReadout,
} from './model.js';
import { createAirportsLayer } from './index.js';
const airport = (id = '1', type = 'large_airport') => ({
  id,
  ident: 'TEST',
  name: '<Airport>',
  type,
  lat: 10,
  lon: 20,
  elevationM: 50,
  country: 'Namibia',
  countryCode: 'NA',
  icaoCode: '',
  iataCode: '',
  municipality: '',
});
test('zoom policy and bounded markers exclude closed', () => {
  assert.deepEqual(airportTypesForHeight(9000000), [
    'large_airport',
    'medium_airport',
  ]);
  assert.ok(airportTypesForHeight(10000).includes('heliport'));
  assert.equal(
    selectAirports(
      [
        airport('closed', 'closed'),
        ...Array.from({ length: 1300 }, (_, i) => airport(String(i))),
      ],
      airportTypesForHeight(10000),
    ).length,
    1200,
  );
});
test('details preserve code identity, MSL and provenance with escaped text', () => {
  const context = airportContext(airport(), {
    revision: 'abc',
    updatedAt: '2026-10-21',
    source: 'OurAirports',
    sourceUrl: 'https://ourairports.com/data/',
  });
  assert.equal(context.properties.ident, 'TEST');
  assert.equal(context.properties.icaoCode, null);
  assert.equal(context.properties.elevationM, 50);
  assert.equal(context.properties.revision, 'abc');
  assert.match(
    airportDescription(airport(), context.properties),
    /&lt;Airport&gt;/,
  );
  assert.match(airportDescription(airport(), context.properties), /MSL/);
});

test('facility types are readable translated labels rather than internal codes', () => {
  const text = airportDescription(airport(), {}, (value) =>
    value === 'Large airport' ? '大型机场' : value,
  );
  assert.match(text, /大型机场/);
  assert.doesNotMatch(text, /large_airport/);
});

test('airport row shows its bounded counts and limit notice in the ordinary layer panel', async () => {
  const h = harness({
    getSnapshot: async () => ({
      airports: [airport()],
      revision: 'r1',
      updatedAt: '2026-10-21',
      total: 100,
      matched: 5,
      truncated: true,
    }),
  });
  h.layer.enable();
  await h.layer.update();
  const row = h.layer.getRowControls();
  assert.equal(row.readout, false);
  assert.match(row.info, /Airport display limited/);
  assert.match(row.info, /1 \/ 5/);
  h.layer.destroy();
});
function harness(source, services = {}) {
  const sources = [];
  const callbacks = new Set();
  const entries = [];
  const viewer = {
    camera: {
      positionCartographic: { height: 9000000 },
      moveEnd: {
        addEventListener(fn) {
          callbacks.add(fn);
          return () => callbacks.delete(fn);
        },
      },
    },
    dataSources: {
      add(ds) {
        sources.push(ds);
      },
      remove(ds) {
        sources.splice(sources.indexOf(ds), 1);
      },
    },
    scene: { canvas: {}, requestRender() {} },
  };
  const overlayHost = {
    setVisible() {},
    clearSource() {
      entries.length = 0;
    },
    setEntries(id, rows) {
      entries.splice(0, entries.length, ...rows);
    },
  };
  const contexts = [];
  const layer = createAirportsLayer({
    createInputHandler: () => ({ setInputAction() {}, destroy() {} }),
    ...services,
    source,
    overlayHost,
    registerEntityContext(e, c) {
      contexts.push(c);
    },
    removeEntityContextsForLayer(id, { retainIds } = {}) {
      for (let i = contexts.length - 1; i >= 0; i--)
        if (!retainIds?.has(contexts[i].id)) contexts.splice(i, 1);
    },
  });
  layer.init(viewer);
  return { layer, viewer, sources, callbacks, entries, contexts };
}
test('airports use shared aircraft silhouettes rather than point dots and tint with the theme', async () => {
  let theme;
  let color = '#33ccff';
  const h = harness(
    {
      getSnapshot: async () => ({
        airports: [airport(), airport('2', 'small_airport')],
      }),
    },
    {
      getPalette: () => ({ primaryOnDark: color }),
      subscribeTheme: (callback) => {
        theme = callback;
        return () => {};
      },
    },
  );
  h.viewer.camera.positionCartographic.height = 10000;
  h.layer.enable();
  await h.layer.update();
  const [major, minor] = h.sources[0].entities.values;
  assert.equal(major.point, undefined, 'a point is not an airport symbol');
  assert.ok(major.billboard, 'airport has a billboard');
  const image = major.billboard.image.getValue();
  assert.match(decodeURIComponent(image), /<svg[\s>]/);
  assert.match(decodeURIComponent(image), /<path/);
  assert.equal(
    minor.billboard.image.getValue(),
    image,
    'all airport markers share one aircraft image',
  );
  assert.equal(major.billboard.width.getValue(), 16);
  assert.equal(minor.billboard.width.getValue(), 12);
  assert.equal(
    major.billboard.color.getValue().toCssColorString(),
    'rgb(51,204,255)',
  );
  color = '#ffcc33';
  theme();
  assert.equal(
    major.billboard.color.getValue().toCssColorString(),
    'rgb(255,204,51)',
  );
  h.layer.destroy();
});

test('airport symbols stay compact across globe, regional and local zoom without thinning the cohort', async () => {
  const records = [
    airport('large'),
    airport('medium', 'medium_airport'),
    airport('small', 'small_airport'),
  ];
  const h = harness({ getSnapshot: async () => ({ airports: records }) });
  h.layer.enable();
  for (const height of [9000000, 500000, 10000]) {
    h.viewer.camera.positionCartographic.height = height;
    await h.layer.update();
    const entities = h.sources[0].entities.values;
    assert.equal(entities.length, height === 9000000 ? 2 : 3);
    for (const entity of entities) {
      const size =
        entity.id === 'airport:large'
          ? 16
          : entity.id === 'airport:medium'
            ? 14
            : 12;
      assert.equal(entity.billboard.width.getValue(), size);
      assert.equal(entity.billboard.height.getValue(), size);
      assert.equal(entity.billboard.scaleByDistance, undefined);
    }
  }
  h.layer.destroy();
});
test('layer distinguishes heliports, civil service, military, joint use and unknown with a matching legend', async () => {
  const h = harness({
    getSnapshot: async () => ({
      airports: [
        { ...airport('1'), scheduledService: true },
        {
          ...airport('2'),
          icaoCode: 'KEDW',
          lat: 34.910781,
          lon: -117.886391,
          wikipedia: 'https://en.wikipedia.org/wiki/Edwards_Air_Force_Base',
          scheduledService: false,
        },
        {
          ...airport('3'),
          icaoCode: 'ZBZJ',
          lat: 40.738664,
          lon: 114.933395,
          wikipedia:
            'https://en.wikipedia.org/wiki/Zhangjiakou_Ningyuan_Airport',
          scheduledService: false,
        },
        { ...airport('4', 'heliport'), scheduledService: false },
        { ...airport('5', 'small_airport'), scheduledService: false },
      ],
    }),
  });
  h.viewer.camera.positionCartographic.height = 10000;
  h.layer.enable();
  await h.layer.update();
  const entities = h.sources[0].entities.values;
  assert.equal(
    new Set(entities.map((e) => e.billboard.image.getValue())).size,
    5,
  );
  assert.equal(
    entities
      .find((e) => e.properties.airportId.getValue() === '4')
      .properties.airportSymbol.getValue()
      .split(':')[0],
    'helicopter',
  );
  const legend = h.layer.getRowControls().legend;
  for (const label of [
    'Heliport',
    'Military airfield',
    'Joint-use airfield',
    'Civil aviation service confirmed',
    'Airport usage unconfirmed',
  ]) {
    const row = legend.find((r) => r.label === label);
    assert.ok(row, label);
    assert.equal(row.count, 1);
    assert.match(row.icon, /^data:image\/svg\+xml/);
  }
  assert.ok(
    entities
      .find((e) => e.properties.airportId.getValue() === '2')
      .gevLabelModel.details.some((line) => line.includes('Wikidata')),
  );
  h.layer.destroy();
});
test('bounded labels, ground anchors, failure keeps display and disable clears', async () => {
  let fail = false;
  const h = harness({
    async getSnapshot() {
      if (fail) throw Error('offline');
      return {
        revision: 'r',
        airports: Array.from({ length: 1300 }, (_, i) => airport(String(i))),
      };
    },
  });
  h.layer.enable();
  await h.layer.update();
  assert.equal(h.sources[0].entities.values.length, 1200);
  assert.ok(h.entries.length <= 96);
  const cartesian = h.sources[0].entities.values[0].position.getValue();
  assert.ok(
    Math.abs(Math.hypot(cartesian.x, cartesian.y, cartesian.z) - 6377497) < 100,
  );
  fail = true;
  await h.layer.update();
  assert.equal(h.layer.getStats().count, 1200);
  h.layer.disable();
  assert.equal(h.contexts.length, 0);
  assert.equal(h.callbacks.size, 0);
  assert.equal(h.entries.length, 0);
  h.layer.destroy();
  assert.equal(h.sources.length, 0);
});
test('disable aborts pending viewport and stale response cannot publish', async () => {
  let signal;
  let resolve;
  const h = harness({
    getSnapshot(options) {
      signal = options.signal;
      return new Promise((r) => (resolve = r));
    },
  });
  h.layer.enable();
  const pending = h.layer.update();
  h.layer.disable();
  assert.equal(signal.aborted, true);
  resolve({ airports: [airport()] });
  await pending;
  assert.equal(h.layer.getStats().count, 0);
});
test('camera changes abort old viewport, refresh filters and listener is restored on re-enable', async () => {
  const calls = [];
  const h = harness({
    getSnapshot(options) {
      return new Promise((resolve) => calls.push({ options, resolve }));
    },
  });
  h.layer.enable();
  assert.equal(calls.length, 1);
  h.viewer.camera.positionCartographic.height = 10000;
  for (const callback of h.callbacks) callback();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.signal.aborted, true);
  assert.ok(calls[1].options.types.includes('heliport'));
  calls[1].resolve({ airports: [airport('new', 'heliport')] });
  await h.layer.update();
  calls[0].resolve({ airports: [airport('old')] });
  await Promise.resolve();
  assert.equal(h.layer.getAnalystRecords()[0].id, 'new');
  h.layer.disable();
  h.layer.enable();
  assert.equal(h.callbacks.size, 1);
  h.layer.destroy();
  assert.equal(calls.at(-1).options.signal.aborted, true);
});
test('theme roles and detail descriptions use current palette and escaping', async () => {
  const h = harness({
    async getSnapshot() {
      return { airports: [airport()] };
    },
  });
  h.layer.enable();
  await h.layer.update();
  assert.equal(h.contexts[0].id, 'airport:1');
  assert.match(
    h.sources[0].entities.values[0].description.getValue(),
    /&lt;Airport&gt;/,
  );
  h.layer.destroy();
});
test('row readout reports directory provenance and honest truncation', async () => {
  const h = harness({
    async getSnapshot() {
      return {
        revision: 'abc',
        updatedAt: '2026-10-21',
        total: 80000,
        matched: 2000,
        truncated: true,
        airports: [airport()],
      };
    },
  });
  h.layer.enable();
  await h.layer.update();
  assert.equal(h.layer.getStats().truncated, true);
  assert.equal(h.layer.getRowControls().summary.validTime, '2026-10-21');
  assert.match(h.layer.getRowControls().summary.detail, /abc/);
  h.layer.destroy();
});
test('airport clicks claim shared selection only for own markers and free pointer, cleanup destroys handler', async () => {
  let callback,
    destroyed = 0,
    free = true;
  const selected = [];
  const h = harness(
    {
      async getSnapshot() {
        return { airports: [airport()] };
      },
    },
    {
      createInputHandler() {
        return {
          setInputAction(fn) {
            callback = fn;
          },
          destroy() {
            destroyed++;
          },
        };
      },
      isPointerFree() {
        return free;
      },
      selectEntityContext(entity) {
        selected.push(entity);
      },
    },
  );
  h.layer.enable();
  await h.layer.update();
  const entity = h.sources[0].entities.values[0];
  h.viewer.scene.pick = () => ({ id: entity });
  free = false;
  callback({ position: {} });
  assert.equal(selected.length, 0);
  free = true;
  callback({ position: {} });
  assert.equal(selected[0], entity);
  assert.ok(entity.gevLabelModel.details.some((line) => line.includes('MSL')));
  assert.ok(entity.gevDisplayPosition());
  h.viewer.scene.pick = () => ({ id: { id: 'other' } });
  callback({ position: {} });
  assert.equal(selected.length, 1);
  h.layer.disable();
  assert.equal(destroyed, 1);
  h.layer.destroy();
  assert.equal(destroyed, 1);
});
test('overlay anchors use shared terrain floor while airport MSL remains metadata', async () => {
  const h = harness(
    {
      async getSnapshot() {
        return { airports: [airport()] };
      },
    },
    { getGroundHeight: () => 321 },
  );
  h.layer.enable();
  await h.layer.update();
  const entity = h.sources[0].entities.values[0];
  const { Cartographic } = await import('cesium');
  assert.ok(
    Math.abs(
      Cartographic.fromCartesian(entity.gevDisplayPosition()).height - 321,
    ) < 0.001,
  );
  assert.equal(h.contexts[0].properties.elevationM, 50);
  h.layer.destroy();
});
test('theme changes recolor cached markers and cards without source reads and unsubscribe on disable', async () => {
  let calls = 0,
    notify,
    removed = 0,
    primary = '#ff0000';
  const h = harness(
    {
      async getSnapshot() {
        calls++;
        return { airports: [airport()] };
      },
    },
    {
      getPalette: () => ({ primaryOnDark: primary }),
      subscribeTheme(fn) {
        notify = fn;
        return () => removed++;
      },
    },
  );
  h.layer.enable();
  await h.layer.update();
  primary = '#00ff00';
  notify();
  assert.equal(calls, 1);
  assert.equal(h.entries[0].accent, '#00ff00');
  assert.equal(h.sources[0].entities.values[0].gevLabelModel.accent, '#00ff00');
  h.layer.disable();
  assert.equal(removed, 1);
  h.layer.destroy();
  assert.equal(removed, 1);
});
test('selected airport keeps its entity through refresh so revision, anchor and theme republish without stealing selection', async () => {
  const {
    initTrackedReadout,
    destroyTrackedReadout,
    refreshTrackedReadout,
    _setTrackedOverlayHostForTest,
    getActiveTrackedReadoutId,
  } = await import('../../data/trackedReadout.js');
  const oldWindow = globalThis.window;
  const win = new EventTarget();
  globalThis.window = win;
  const publications = [];
  let click,
    theme,
    version = 1,
    accent = '#ff0000';
  _setTrackedOverlayHostForTest({
    setVisible() {},
    clearSource() {},
    setEntries(id, entries) {
      publications.push(entries[0]);
    },
  });
  const h = harness(
    {
      async getSnapshot() {
        return {
          revision: `r${version}`,
          airports: [{ ...airport(), lon: 20 + version }],
        };
      },
    },
    {
      createInputHandler() {
        return {
          setInputAction(fn) {
            click = fn;
          },
          destroy() {},
        };
      },
      selectEntityContext(entity) {
        win.dispatchEvent(
          new CustomEvent('gev:entity-selected', {
            detail: { layerId: 'airports', entity },
          }),
        );
      },
      refreshSelectedReadout: refreshTrackedReadout,
      getPalette: () => ({ primaryOnDark: accent }),
      subscribeTheme(fn) {
        theme = fn;
        return () => {};
      },
    },
  );
  try {
    initTrackedReadout(h.viewer);
    h.layer.enable();
    await h.layer.update();
    const original = h.sources[0].entities.values[0];
    h.viewer.scene.pick = () => ({ id: original });
    click({ position: {} });
    assert.equal(getActiveTrackedReadoutId(), 'airport:1');
    version = 2;
    await h.layer.update();
    assert.equal(h.sources[0].entities.values[0], original);
    assert.ok(publications.at(-1).details.some((line) => line.includes('r2')));
    const { Cartographic, Math: CMath } = await import('cesium');
    assert.ok(
      Math.abs(
        CMath.toDegrees(
          Cartographic.fromCartesian(publications.at(-1).position()).longitude,
        ) - 22,
      ) < 1e-6,
    );
    accent = '#00ff00';
    theme();
    assert.equal(publications.at(-1).accent, '#00ff00');
    win.dispatchEvent(
      new CustomEvent('gev:entity-selected', {
        detail: { layerId: 'military-installations', entity: {} },
      }),
    );
    const count = publications.length;
    version = 3;
    await h.layer.update();
    theme();
    assert.equal(publications.length, count);
    assert.equal(getActiveTrackedReadoutId(), null);
  } finally {
    h.layer.destroy();
    destroyTrackedReadout();
    _setTrackedOverlayHostForTest();
    globalThis.window = oldWindow;
  }
});
test('viewport eviction removes missing carrier, clears viewer selection and prunes its context', async () => {
  let missing = false,
    click;
  const h = harness(
    {
      async getSnapshot() {
        return { airports: missing ? [] : [airport()] };
      },
    },
    {
      createInputHandler() {
        return {
          setInputAction(fn) {
            click = fn;
          },
          destroy() {},
        };
      },
    },
  );
  h.layer.enable();
  await h.layer.update();
  const entity = h.sources[0].entities.values[0];
  h.viewer.scene.pick = () => ({ id: entity });
  click({ position: {} });
  assert.equal(h.viewer.selectedEntity, entity);
  missing = true;
  await h.layer.update();
  assert.equal(h.sources[0].entities.values.length, 0);
  assert.equal(h.viewer.selectedEntity, undefined);
  assert.equal(h.contexts.length, 0);
  h.layer.destroy();
});

test('airport readout presents compact facts while full provenance remains in context', async () => {
  const { airportReadout } = await import('./model.js');
  const a = {
    ...airport(),
    name: 'Test Airport',
    icaoCode: 'ZBAA',
    iataCode: 'PEK',
    scheduledService: true,
  };
  const snapshot = {
    source: 'OurAirports',
    revision: 'very-long-revision',
    sourceUrl: 'https://ourairports.com/data/',
    updatedAt: '2026-10-21T00:00:00Z',
  };
  const model = airportReadout(a, snapshot);
  assert.equal(model.title, 'Test Airport');
  assert.deepEqual(model.codes, [
    { label: 'ICAO', value: 'ZBAA' },
    { label: 'IATA', value: 'PEK' },
  ]);
  assert.equal(model.rows.length, 6);
  assert.ok(
    model.rows.some(
      ([label, value]) => label === 'Elevation (m MSL)' && value === 50,
    ),
  );
  assert.ok(!JSON.stringify(model.rows).includes('very-long-revision'));
  assert.equal(
    airportContext(a, snapshot).properties.revision,
    'very-long-revision',
  );
});

test('airport country display follows locale while source context stays intact', () => {
  const a = airport();
  const model = airportReadout(a, {}, (value) => value, 'zh-CN');
  assert.equal(
    model.rows.find(([label]) => label === 'Country')[1],
    '纳米比亚',
  );
  assert.equal(airportContext(a, {}).properties.country, 'Namibia');
});
test('locale refresh retains selected carrier and rejects late prior locale response', async () => {
  let locale = 'en',
    resolveOld;
  const h = harness(
    {
      getSnapshot: () =>
        locale === 'en'
          ? new Promise((resolve) => {
              resolveOld = resolve;
            })
          : Promise.resolve({ airports: [{ ...airport(), name: '机场' }] }),
    },
    { getLocale: () => locale },
  );
  h.layer.enable();
  const old = h.layer.update();
  locale = 'zh-CN';
  await h.layer.refresh();
  const entity = h.sources[0].entities.values[0];
  h.viewer.selectedEntity = entity;
  resolveOld({ airports: [airport()] });
  await old;
  assert.equal(entity.name, '机场');
  await h.layer.refresh();
  assert.equal(h.viewer.selectedEntity, entity);
  assert.equal(h.sources[0].entities.values[0], entity);
  h.layer.destroy();
});
