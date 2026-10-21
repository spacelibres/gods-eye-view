#!/usr/bin/env node
/** Global airports: fixture-backed real map, selection, search, themes and mobile.
 * Start the dev server, then QA_BASE_URL=http://localhost:4173 node scripts/qa-airports.mjs.
 * Airport traffic is intercepted at same-origin API boundaries; no upstream download.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer';

const base = process.env.QA_BASE_URL || 'http://localhost:4173';
const shots = process.env.QA_SHOTS_DIR || 'qa-shots/airports';
fs.mkdirSync(shots, { recursive: true });
const make = (id, name, type, codes = {}) => ({
  id,
  ident: codes.icaoCode || `QA-${id}`,
  name,
  type,
  lat: 51.4706 + (Number(id) % 3) * 0.025,
  lon: -0.461941,
  elevationM: 25.3,
  countryCode: 'GB',
  country: 'United Kingdom',
  regionCode: 'GB-ENG',
  region: 'England',
  municipality: 'London',
  icaoCode: '',
  iataCode: '',
  gpsCode: '',
  localCode: '',
  scheduledService: true,
  keywords: '',
  website: '',
  wikipedia: '',
  ...codes,
});
const heathrow = make('2434', 'London Heathrow Airport', 'large_airport', {
  icaoCode: 'EGLL',
  iataCode: 'LHR',
});
heathrow.lat = 51.4706;
const small = make('3', 'QA Small Airfield', 'small_airport');
small.lat = heathrow.lat + 0.025;
const closed = make('4', 'QA Closed Airport', 'closed');
const heliport = make('600', 'QA Helicopter Landing Pad', 'heliport', {
  scheduledService: false,
});
heliport.lat = 51.48;
heliport.lon = -0.52;
const militaryAirport = make('601', 'QA Military Airfield', 'medium_airport', {
  icaoCode: 'KEDW',
  wikipedia: 'https://en.wikipedia.org/wiki/Edwards_Air_Force_Base',
  countryCode: 'US',
  country: 'United States',
  scheduledService: false,
});
militaryAirport.lat = 34.910781;
militaryAirport.lon = -117.886391;
const jointAirport = make('602', 'QA Joint-use Airfield', 'medium_airport', {
  icaoCode: 'ZBZJ',
  wikipedia: 'https://en.wikipedia.org/wiki/Zhangjiakou_Ningyuan_Airport',
  countryCode: 'CN',
  country: 'China',
  scheduledService: false,
});
jointAirport.lat = 40.738664;
jointAirport.lon = 114.933395;
const unknownAirport = make('606', 'QA General Airfield', 'small_airport', {
  scheduledService: false,
});
unknownAirport.lat = 51.44;
unknownAirport.lon = -0.52;
const duplicates = [
  make('7', 'QA North Airport', 'small_airport', { iataCode: 'DUP' }),
  make('8', 'QA South Airport', 'small_airport', { iataCode: 'DUP' }),
];
const navaids = [
  {
    id: '501',
    ident: 'LON',
    name: 'London VOR-DME',
    type: 'VOR-DME',
    lat: 51.45,
    lon: -0.49,
    elevationM: 25,
    countryCode: 'GB',
    country: 'United Kingdom',
    frequencyKhz: 113600,
    dmeFrequencyKhz: 113600,
    dmeChannel: '083X',
    dmeLat: 51.45,
    dmeLon: -0.49,
    dmeElevationM: 25,
    magneticVariationDeg: -1,
    slavedVariationDeg: -2,
    usageType: 'BOTH',
    power: 'HIGH',
    associatedAirport: 'EGLL',
  },
  {
    id: '502',
    ident: 'QA',
    name: 'QA NDB',
    type: 'NDB',
    lat: 51.49,
    lon: -0.43,
    elevationM: null,
    countryCode: 'GB',
    country: 'United Kingdom',
    frequencyKhz: 375,
    dmeFrequencyKhz: null,
    dmeChannel: '',
    dmeLat: null,
    dmeLon: null,
    dmeElevationM: null,
    magneticVariationDeg: null,
    slavedVariationDeg: null,
    usageType: 'TERMINAL',
    power: 'LOW',
    associatedAirport: '',
  },
];
const all = [
  heathrow,
  small,
  closed,
  heliport,
  militaryAirport,
  jointAirport,
  unknownAirport,
];
const meta = {
  revision: 'airport-browser-fixture-1',
  updatedAt: '2026-10-21T00:00:00Z',
  source: 'OurAirports',
  sourceUrl: 'https://ourairports.com/data/',
};
const list = (airports, matched = airports.length) => ({
  ...meta,
  total: 10,
  matched,
  truncated: matched > airports.length,
  airports,
});
const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--no-sandbox',
    ...(process.platform === 'darwin'
      ? ['--use-angle=metal']
      : ['--use-gl=angle', '--use-angle=swiftshader']),
  ],
});
const page = await browser.newPage();
let viewReads = 0,
  searchReads = 0,
  failViews = false;
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.setRequestInterception(true);
page.on('request', (request) => {
  const url = new URL(request.url());
  const reply = (body, status = 200) =>
    request.respond({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  if (url.hostname === 'photon.komoot.io')
    return void reply({
      features: [
        {
          geometry: { type: 'Point', coordinates: [12.4964, 41.9028] },
          properties: {
            name: 'Rome',
            country: 'Italy',
            osm_key: 'place',
            osm_value: 'city',
            type: 'city',
          },
        },
      ],
    });
  if (url.origin !== new URL(base).origin) return void request.continue();
  if (url.pathname === '/api/airports/navaids')
    return void reply({
      ...meta,
      total: 2,
      matched: 2,
      truncated: false,
      navaids,
    });
  if (url.pathname === '/api/airports/countries')
    return void reply({
      ...meta,
      countries: [
        {
          code: 'GB',
          name: 'United Kingdom',
          continent: 'EU',
          wikipedia: '',
          keywords: '',
        },
        {
          code: 'CN',
          name: 'China',
          continent: 'AS',
          wikipedia: '',
          keywords: '',
        },
        {
          code: 'NA',
          name: 'Namibia',
          continent: 'AF',
          wikipedia: '',
          keywords: '',
        },
      ],
    });
  if (url.pathname === '/api/airports/search') {
    searchReads++;
    const q = url.searchParams.get('q');
    return void reply(
      list(
        q === 'DUP'
          ? duplicates
          : ['EGLL', 'LHR', 'London Heathrow Airport'].includes(q)
            ? [heathrow]
            : [],
      ),
    );
  }
  if (url.pathname === '/api/airports/detail')
    return void reply({ ...meta, airport: heathrow });
  if (url.pathname === '/api/airports') {
    viewReads++;
    if (failViews) {
      return void reply({ error: 'fixture unavailable' }, 503);
    }
    const types = url.searchParams.get('types')?.split(',');
    return void reply(
      list(
        all.filter((a) =>
          types ? types.includes(a.type) : a.type !== 'closed',
        ),
      ),
    );
  }
  if (['/api/google/geocode', '/api/geocode'].includes(url.pathname))
    return void reply({
      status: 'OK',
      results: [
        {
          formatted_address: 'Rome, Italy',
          geometry: { location: { lat: 41.9028, lng: 12.4964 } },
          types: ['locality'],
        },
      ],
    });
  return void request.continue();
});
const check = (name, pass, detail) => {
  console.log(
    `[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? `: ${detail}` : ''}`,
  );
  assert.ok(pass, name);
};
const state = () =>
  page.evaluate(() => {
    const { dataManager, viewer } = window.__godsEyeView;
    const layer = dataManager.layers.get('airports').module;
    return {
      enabled: dataManager.isEnabled('airports'),
      stats: layer.getStats(),
      ids: layer.getAnalystRecords().map((a) => a.id),
      height: viewer.camera.positionCartographic.height,
    };
  });
const camera = (height, lat = 51.4706, lon = -0.461941) =>
  page.evaluate(
    async ({ height: h, lat, lon }) => {
      const C = await import('/node_modules/cesium/Build/Cesium/index.js');
      const v = window.__godsEyeView.viewer;
      v.camera.setView({
        destination: C.Cartesian3.fromDegrees(lon, lat, h),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
      await window.__godsEyeView.dataManager.layers
        .get('airports')
        .module.update();
      v.scene.requestRender();
    },
    { height, lat, lon },
  );
const search = async (query) => {
  await page.evaluate((q) => {
    document.querySelector('#location-bar-toggle').click();
    const input = document.getElementById('location-search');
    input.value = q;
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
  }, query);
};
try {
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto(`${base}/?welcome=0&lang=en`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction(
    () => window.__godsEyeView?.dataManager?.layers?.has('airports'),
    { timeout: 60000 },
  );
  await page.waitForFunction(
    () =>
      document.getElementById('loading-screen')?.classList.contains('hidden'),
    { timeout: 90000 },
  );
  await page.evaluate(async () => {
    const { visitTargetSprites } =
      await import('/src/overlays/markerLayout.js');
    window.__qaTargetPoint = (entity) => {
      const v = window.__godsEyeView.viewer;
      let point = null;
      visitTargetSprites(v.scene.primitives, (sprite) => {
        if (
          sprite.id === entity &&
          sprite.show &&
          sprite.clusterShow &&
          !(
            sprite.translucencyByDistance?.nearValue === 0 &&
            sprite.translucencyByDistance?.farValue === 0
          )
        )
          point = sprite.computeScreenSpacePosition(v.scene);
      });
      return point;
    };
  });
  check(
    'airports default off and construction makes no directory request',
    !(await state()).enabled && viewReads === 0,
  );
  await page.$eval('[data-layer-id="airports"] .data-toggle-btn', (button) =>
    button.click(),
  );
  await page.waitForFunction(
    () =>
      window.__godsEyeView.dataManager.layers.get('airports').module.getStats()
        .count > 0,
  );
  await camera(4_000_000);
  let s = await state();
  check(
    'world scale prioritizes large/medium facilities and excludes closed',
    s.ids.includes('2434') && !s.ids.includes('3') && !s.ids.includes('4'),
  );
  check(
    'world view displays country names and hides nearby navigation facilities',
    s.stats.countryCount > 0 && s.stats.navaidCount === 0,
  );
  await page.screenshot({ path: `${shots}/country-names.png` });
  await camera(25000);
  s = await state();
  check(
    'nearby view includes small airfields and preserves provenance',
    s.ids.includes('3') && s.stats.revision === meta.revision,
  );
  check(
    'nearby view displays VOR and NDB station symbols',
    s.stats.navaidCount === 2 && s.stats.countryCount === 0,
  );
  check(
    'airport marker is an aircraft billboard rather than a dot',
    await page.evaluate(() => {
      const e = window.__gevContextStore.entities.get('airport:2434').entity;
      return (
        !e.point &&
        !!e.billboard &&
        decodeURIComponent(e.billboard.image.getValue()).includes('<path')
      );
    }),
  );
  check(
    'facility and usage categories have distinct map symbols',
    await page.evaluate(() => {
      const ids = ['2434', '600', '601', '602', '606'];
      const entities = ids.map(
        (id) => window.__gevContextStore.entities.get(`airport:${id}`).entity,
      );
      return (
        new Set(entities.map((e) => e.billboard.image.getValue())).size === 5 &&
        entities[1].properties.airportSymbol
          .getValue()
          .startsWith('helicopter:') &&
        entities[2].properties.airportUsage.getValue() === 'military' &&
        entities[3].properties.airportUsage.getValue() === 'joint'
      );
    }),
  );
  check(
    'layer legend displays actual facility and usage icons',
    await page.$$eval(
      '[data-layer-id="airports"] .data-toggle-legend-icon',
      (imgs) =>
        imgs.length === 7 &&
        imgs.every(
          (img) => img.alt === '' && img.getAttribute('aria-hidden') === 'true',
        ),
    ),
  );
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector('.target-marker-leaders')?.dataset
          .displacedCount,
      ) > 0,
  );
  await page.waitForFunction(async () => {
    const { visitTargetSprites } =
      await import('/src/overlays/markerLayout.js');
    const v = window.__godsEyeView.viewer;
    let count = 0,
      ready = true;
    visitTargetSprites(v.scene.primitives, (s, c, point) => {
      if (c.ready === false) ready = false;
      if (point || !s.show || !s.clusterShow) return;
      const p = s.computeScreenSpacePosition(v.scene);
      if (
        p &&
        p.x >= 0 &&
        p.y >= 0 &&
        p.x <= v.scene.canvas.clientWidth &&
        p.y <= v.scene.canvas.clientHeight
      )
        count++;
    });
    v.scene.requestRender();
    return count >= 5 && ready;
  });
  const collision = await page.evaluate(async () => {
    const { visitTargetSprites } =
      await import('/src/overlays/markerLayout.js');
    const v = window.__godsEyeView.viewer;
    const rects = [];
    visitTargetSprites(v.scene.primitives, (sprite, collection, point) => {
      if (
        point ||
        !sprite.show ||
        !sprite.clusterShow ||
        (sprite.translucencyByDistance?.nearValue === 0 &&
          sprite.translucencyByDistance?.farValue === 0) ||
        sprite.color.alpha < 0.02
      )
        return;
      const p = sprite.computeScreenSpacePosition(v.scene);
      if (
        !p ||
        p.x < 0 ||
        p.y < 0 ||
        p.x > v.scene.canvas.clientWidth ||
        p.y > v.scene.canvas.clientHeight
      )
        return;
      const size =
        Math.max(sprite.width || 32, sprite.height || 32) * sprite.scale;
      rects.push({ x: p.x, y: p.y, size });
    });
    for (let i = 0; i < rects.length; i++)
      for (const b of rects.slice(i + 1)) {
        const a = rects[i];
        if (
          Math.abs(a.x - b.x) < (a.size + b.size) / 2 - 0.5 &&
          Math.abs(a.y - b.y) < (a.size + b.size) / 2 - 0.5
        )
          return { ok: false, count: rects.length, a, b };
      }
    return { ok: true, count: rects.length };
  });
  if (collision.count < 5)
    console.log(
      'Collision diagnostics',
      await page.evaluate(async () => {
        const { visitTargetSprites } =
          await import('/src/overlays/markerLayout.js');
        const rows = [];
        visitTargetSprites(
          window.__godsEyeView.viewer.scene.primitives,
          (s, c, point) => {
            const p = s.computeScreenSpacePosition(
              window.__godsEyeView.viewer.scene,
            );
            rows.push({
              id: s.id?.id || s.id,
              show: s.show,
              cluster: s.clusterShow,
              point: !!point,
              alpha: s.color.alpha,
              p: { x: p?.x, y: p?.y },
            });
          },
        );
        return {
          rows,
          canvas: {
            ...document.querySelector('.target-marker-leaders')?.dataset,
          },
        };
      }),
    );
  check(
    'native airport and navaid sprites share one nonoverlapping screen layout',
    collision.ok && collision.count >= 5,
    JSON.stringify(collision),
  );
  const mixed = await page.evaluate(async () => {
    const C = await import('/node_modules/cesium/Build/Cesium/index.js');
    const v = window.__godsEyeView.viewer;
    const collection = v.scene.primitives.add(new C.BillboardCollection());
    const points = v.scene.primitives.add(new C.PointPrimitiveCollection());
    const position = C.Cartesian3.fromDegrees(-0.461941, 51.4706, 100);
    const image = window.__gevContextStore.entities
      .get('airport:2434')
      .entity.billboard.image.getValue();
    let mixedIndex = 0;
    for (const [id, color] of [
      ['qa-plane', '#ffa526'],
      ['qa-vessel', '#39d0ff'],
      ['qa-camera', '#c7a0ff'],
    ])
      collection.add({
        id,
        image,
        position: C.Cartesian3.fromDegrees(
          -0.4,
          51.44 + mixedIndex++ * 0.025,
          100,
        ),
        width: 28,
        height: 28,
        color: C.Color.fromCssColorString(color),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
    points.add({
      id: 'qa-satellite',
      position: C.Cartesian3.fromDegrees(-0.4, 51.515, 100),
      pixelSize: 20,
      color: C.Color.LIME,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
    window.__qaMixed = { collection, points };
    v.scene.requestRender();
    return true;
  });
  await page.waitForFunction(async () => {
    const { visitTargetSprites } =
      await import('/src/overlays/markerLayout.js');
    const v = window.__godsEyeView.viewer;
    const ids = new Set();
    visitTargetSprites(v.scene.primitives, (s) => {
      if (s.show && s.clusterShow && String(s.id).startsWith('qa-'))
        ids.add(s.id);
    });
    v.scene.requestRender();
    return ids.size === 4;
  });
  await page.waitForFunction(async () => {
    const { visitTargetSprites } =
      await import('/src/overlays/markerLayout.js');
    let ready = true;
    visitTargetSprites(window.__godsEyeView.viewer.scene.primitives, (s, c) => {
      if (c.ready === false) ready = false;
    });
    window.__godsEyeView.viewer.scene.requestRender();
    return ready;
  });
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const scene = window.__godsEyeView.viewer.scene;
        let frames = 0;
        const remove = scene.postRender.addEventListener(() => {
          if (++frames >= 2) {
            remove();
            resolve();
          } else scene.requestRender();
        });
        scene.requestRender();
      }),
  );
  const mixedPicks = await page.evaluate(async () => {
    const { visitTargetSprites } =
      await import('/src/overlays/markerLayout.js');
    const v = window.__godsEyeView.viewer;
    const found = [];
    visitTargetSprites(v.scene.primitives, (s) => {
      if (!s.show || !s.clusterShow || !String(s.id).startsWith('qa-')) return;
      const p = s.computeScreenSpacePosition(v.scene);
      for (let x = -8; x <= 8; x += 2)
        for (let y = -8; y <= 8; y += 2)
          if (v.scene.pick({ x: p.x + x, y: p.y + y })?.id === s.id) {
            found.push(s.id);
            return;
          }
    });
    return [...new Set(found)];
  });
  check(
    'mixed aircraft vessel camera and point targets remain individually pickable after separation',
    mixed && mixedPicks.length === 4,
    JSON.stringify(mixedPicks),
  );
  await page.screenshot({ path: `${shots}/global-target-collisions.png` });
  await page.evaluate(() => {
    const v = window.__godsEyeView.viewer;
    v.scene.primitives.remove(window.__qaMixed.collection);
    v.scene.primitives.remove(window.__qaMixed.points);
    delete window.__qaMixed;
    v.scene.requestRender();
  });
  await page.screenshot({ path: `${shots}/airport-categories.png` });
  for (const [record, label] of [
    [militaryAirport, 'military'],
    [jointAirport, 'joint-use'],
  ]) {
    await camera(25000, record.lat, record.lon);
    await page.waitForFunction(
      (id) => {
        const v = window.__godsEyeView.viewer;
        const entity = window.__gevContextStore.entities.get(
          `airport:${id}`,
        )?.entity;
        if (!entity) return false;
        const p = window.__qaTargetPoint(entity);
        v.scene.requestRender();
        if (!p) return false;
        for (let x = -10; x <= 10; x += 2)
          for (let y = -10; y <= 10; y += 2)
            if (v.scene.pick({ x: p.x + x, y: p.y + y })?.id === entity)
              return true;
        return false;
      },
      { timeout: 30000 },
      record.id,
    );
    check(
      `${label} airport symbol renders and is pickable at its real facility location`,
      true,
    );
    await page.screenshot({ path: `${shots}/${label}-airport.png` });
  }
  await camera(25000);
  failViews = true;
  await camera(26000);
  s = await state();
  check(
    'failed directory refresh preserves last good map',
    s.ids.includes('2434') && !!s.stats.error,
  );
  failViews = false;
  await camera(24000);
  await page.waitForFunction(() => {
    const v = window.__godsEyeView.viewer;
    const r = window.__gevContextStore.entities.get('airport:2434');
    const p = window.__qaTargetPoint(r.entity);
    v.scene.requestRender();
    return p && v.scene.pick(p)?.id === r.entity;
  });
  const click = await page.evaluate(() => {
    const record = window.__gevContextStore.entities.get('airport:2434');
    const v = window.__godsEyeView.viewer;
    const p = window.__qaTargetPoint(record.entity);
    const rect = v.scene.canvas.getBoundingClientRect();
    return { x: p.x + rect.left, y: p.y + rect.top };
  });
  await page.waitForFunction(
    ({ x, y }) =>
      document.elementFromPoint(x, y) ===
      window.__godsEyeView.viewer.scene.canvas,
    {},
    click,
  );
  await page.mouse.click(click.x, click.y);
  await page.waitForFunction(
    () => window.__gevContextStore?.selectedEntityId === 'airport:2434',
  );
  const selected = await page.evaluate(async () => {
    const r = window.__gevContextStore.entities.get('airport:2434');
    const { getActiveTrackedReadoutId } =
      await import('/src/data/trackedReadout.js');
    return {
      details: r.entity.gevLabelModel.details.join('\n'),
      active: getActiveTrackedReadoutId(),
      card: document.querySelector('#airport-detail-card')?.textContent,
      visible: document.querySelector('#airport-detail-card')?.hidden === false,
    };
  });
  check(
    'real map click opens one compact airport card with codes, MSL and source',
    /EGLL/.test(selected.details) &&
      /LHR/.test(selected.details) &&
      /25.3/.test(selected.details) &&
      /OurAirports/.test(selected.details) &&
      selected.visible &&
      !selected.active &&
      /EGLL/.test(selected.card) &&
      !/Revision|Usage evidence|Source URL/.test(selected.card),
  );
  await page.screenshot({ path: `${shots}/desktop-details.png` });
  const beforeLocaleReads = viewReads;
  await page.$eval('#locale-picker .locale-picker-button', (el) => el.click());
  await page.$eval('#locale-picker [data-locale="zh-CN"]', (el) => el.click());
  await page.waitForFunction(
    () =>
      document
        .querySelector('#airport-detail-card .airport-detail-close')
        ?.getAttribute('aria-label') === '关闭',
  );
  check(
    'open airport card follows live locale without another directory request',
    viewReads === beforeLocaleReads,
  );
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.screenshot({ path: `${shots}/mobile-airport-details.png` });
  check(
    'mobile airport card stays inside the viewport',
    await page.$eval('#airport-detail-card', (el) => {
      const r = el.getBoundingClientRect();
      return (
        r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight
      );
    }),
  );
  await page.click('#airport-detail-card .airport-detail-close');
  check(
    'close button clears airport context and viewer selection',
    await page.evaluate(
      () =>
        !window.__gevContextStore.selectedEntityId &&
        !window.__godsEyeView.viewer.selectedEntity &&
        document.querySelector('#airport-detail-card').hidden,
    ),
  );
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.$eval('#locale-picker .locale-picker-button', (el) => el.click());
  await page.$eval('#locale-picker [data-locale="en"]', (el) => el.click());
  await page.evaluate(() =>
    window.__godsEyeView.dataManager.layers.get('airports').module.update(),
  );
  check(
    'source refresh cannot reopen a closed airport card',
    await page.$eval('#airport-detail-card', (el) => el.hidden),
  );
  const reopen = async () => {
    const point = await page.evaluate(() => {
      const v = window.__godsEyeView.viewer;
      const e = window.__gevContextStore.entities.get('airport:2434').entity;
      const p = window.__qaTargetPoint(e),
        r = v.scene.canvas.getBoundingClientRect();
      return { x: p.x + r.left, y: p.y + r.top };
    });
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(
      () => document.querySelector('#airport-detail-card')?.hidden === false,
    );
  };
  await reopen();
  await page.keyboard.press('Escape');
  check(
    'Escape dismisses airport details and clears selection',
    await page.evaluate(
      () =>
        !window.__gevContextStore.selectedEntityId &&
        document.querySelector('#airport-detail-card').hidden,
    ),
  );
  await reopen();
  await page.click('#airport-detail-card .airport-detail-close');

  const navClick = await page.evaluate(() => {
    const v = window.__godsEyeView.viewer;
    const e = window.__gevContextStore.entities.get('navaid:501').entity;
    const p = window.__qaTargetPoint(e);
    const rect = v.scene.canvas.getBoundingClientRect();
    for (let x = -8; x <= 8; x += 2)
      for (let y = -8; y <= 8; y += 2) {
        const q = { x: p.x + x, y: p.y + y };
        if (v.scene.pick(q)?.id === e)
          return { x: q.x + rect.left, y: q.y + rect.top };
      }
    return null;
  });
  assert.ok(navClick, 'navigation station billboard is pickable');
  await page.mouse.click(navClick.x, navClick.y);
  await page.waitForFunction(
    () => window.__gevContextStore.selectedEntityId === 'navaid:501',
  );
  check(
    'selected navaid remains active through the Airports lifecycle',
    await page.evaluate(async () => {
      const { getSelectedEntityContext } =
        await import('/src/data/contextStore.js');
      return (
        getSelectedEntityContext({
          dataManager: window.__godsEyeView.dataManager,
        })?.id === 'navaid:501'
      );
    }),
  );
  check(
    'navaid click opens frequency, DME channel, country and source details',
    await page.evaluate(() => {
      const details = window.__gevContextStore.entities
        .get('navaid:501')
        .entity.gevLabelModel.details.join('\n');
      return [
        '113.6 MHz',
        '083X',
        'United Kingdom',
        'OurAirports',
        'EGLL',
      ].every((v) => details.includes(v));
    }),
  );
  await page.waitForFunction(async () => {
    window.__godsEyeView.viewer.scene.requestRender();
    const { getOverlayPaintRect } =
      await import('/src/overlays/worldOverlay.js');
    const r = getOverlayPaintRect('tracked', 'navaid:501');
    return r && r.y >= 0 && r.y + r.h < innerHeight - 100;
  });
  check('full navigation detail card stays clear of bottom controls', true);
  await page.screenshot({ path: `${shots}/navigation-details.png` });
  const readsBeforeTheme = viewReads;
  const colors = await page.evaluate(async () => {
    const runtime = await import('/src/ui/colorSystemRuntime.js');
    const { generatePalette } = await import('/src/ui/colorSystem.js');
    const r = () =>
      window.__gevContextStore.entities.get('airport:2434').entity;
    const before = r().billboard.color.getValue().toCssColorString();
    runtime.applyPalette(
      generatePalette('#8e44ad', 'triad'),
      document.documentElement,
      'triad',
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return { before, after: r().billboard.color.getValue().toCssColorString() };
  });
  check(
    'theme recolors points without a directory read',
    colors.before !== colors.after && viewReads === readsBeforeTheme,
  );
  await page.screenshot({ path: `${shots}/alternate-theme.png` });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.screenshot({ path: `${shots}/mobile.png` });
  check(
    'mobile page has no horizontal overflow',
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await search('EGLL');
  await page.waitForFunction(
    () =>
      !document
        .getElementById('location-search')
        .classList.contains('searching'),
  );
  check(
    'ICAO search uses local directory',
    searchReads > 0 &&
      (await page.$eval('#location-mini-city', (e) =>
        /Heathrow/.test(e.textContent),
      )),
  );
  await search('LHR');
  await page.waitForFunction(
    () =>
      !document
        .getElementById('location-search')
        .classList.contains('searching'),
  );
  check(
    'IATA search locates the same airport',
    await page.$eval('#location-mini-city', (e) =>
      /Heathrow/.test(e.textContent),
    ),
  );
  await search('London Heathrow Airport');
  await page.waitForFunction(
    () =>
      !document
        .getElementById('location-search')
        .classList.contains('searching'),
  );
  check(
    'airport name search locates exact directory identity',
    await page.$eval('#location-mini-city', (e) =>
      /Heathrow/.test(e.textContent),
    ),
  );
  await search('ROME');
  await page.waitForFunction(
    () =>
      !document
        .getElementById('location-search')
        .classList.contains('searching'),
  );
  check(
    'ordinary uppercase city search still works',
    await page.$eval('#location-mini-city', (e) => /Rome/.test(e.textContent)),
  );
  await search('DUP');
  await page.waitForSelector('#poi-row[role="group"] button');
  check(
    'ambiguous airport code presents choices',
    await page.$$eval(
      '#poi-row[role="group"] button',
      (buttons) => buttons.length === 3,
    ),
  );
  await page.$eval('#poi-row[role="group"] button', (button) => button.click());
  await page.waitForFunction(
    () =>
      !document
        .getElementById('location-search')
        .classList.contains('searching'),
  );
  check(
    'explicit airport choice reaches navigation',
    await page.$eval('#location-mini-city', (e) =>
      /QA North Airport/.test(e.textContent),
    ),
  );
  await page.goto(
    `${base}/?welcome=0&lang=en#v=2&l=5&lat=51.4706&lon=-0.461941&alt=24000&pitch=-90`,
    {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    },
  );
  await page.waitForFunction(
    () =>
      window.__godsEyeView?.dataManager?.isEnabled('airports') &&
      window.__godsEyeView.dataManager.layers.get('airports').module.getStats()
        .count > 0,
    { timeout: 60000 },
  );
  check('share link restores the airport layer', (await state()).enabled);
  await page.evaluate(() =>
    window.__godsEyeView.dataManager.setEnabled('airports', false, {
      origin: 'user',
    }),
  );
  check(
    'disable clears airport contexts and points',
    !(await state()).enabled &&
      (await page.evaluate(() =>
        [...window.__gevContextStore.entities.values()].every(
          (r) => !['airports', 'aviation-navaids'].includes(r.layerId),
        ),
      )),
  );
  check(
    'airport feature causes no JavaScript exception',
    pageErrors.length === 0,
    pageErrors.join('; '),
  );
  console.log('Airport browser gate passed.');
} catch (error) {
  await page.screenshot({ path: `${shots}/failure.png` });
  console.log('Failure state:', await state());
  throw error;
} finally {
  await browser.close();
}
