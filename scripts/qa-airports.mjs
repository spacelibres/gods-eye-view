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
const all = [heathrow, small, closed];
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
const camera = (height) =>
  page.evaluate(async (h) => {
    const C = await import('/node_modules/cesium/Build/Cesium/index.js');
    const v = window.__godsEyeView.viewer;
    v.camera.setView({
      destination: C.Cartesian3.fromDegrees(-0.461941, 51.4706, h),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    await window.__godsEyeView.dataManager.layers
      .get('airports')
      .module.update();
    v.scene.requestRender();
  }, height);
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
    const p = v.scene.cartesianToCanvasCoordinates(
      r.entity.gevDisplayPosition(),
    );
    v.scene.requestRender();
    return p && v.scene.pick(p)?.id === r.entity;
  });
  const click = await page.evaluate(() => {
    const record = window.__gevContextStore.entities.get('airport:2434');
    const v = window.__godsEyeView.viewer;
    const p = v.scene.cartesianToCanvasCoordinates(
      record.entity.gevDisplayPosition(),
    );
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
    };
  });
  check(
    'real map click publishes airport codes, MSL and source in shared detail card',
    /EGLL/.test(selected.details) &&
      /LHR/.test(selected.details) &&
      /25.3/.test(selected.details) &&
      /OurAirports/.test(selected.details) &&
      !!selected.active,
  );
  await page.screenshot({ path: `${shots}/desktop-details.png` });
  const navClick = await page.evaluate(() => {
    const v = window.__godsEyeView.viewer;
    const e = window.__gevContextStore.entities.get('navaid:501').entity;
    const p = v.scene.cartesianToCanvasCoordinates(e.gevDisplayPosition());
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
