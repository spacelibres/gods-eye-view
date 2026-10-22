import * as Cesium from 'cesium';
import { loadBundledJson } from '../../data/bundledJson.js';
const msg = (v) => v;
const NAV = 'aviation-navaids',
  COUNTRY = 'airports-country-labels';
export function formatNavaidFrequency(value, type) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return (
    String(value / (String(type).startsWith('NDB') ? 1 : 1000)) +
    (String(type).startsWith('NDB') ? ' kHz' : ' MHz')
  );
}
const symbolCache = new Map();
export function navaidSymbol(type) {
  type = [
    'DME',
    'NDB',
    'NDB-DME',
    'VOR',
    'VOR-DME',
    'VORTAC',
    'TACAN',
  ].includes(type)
    ? type
    : 'VOR';
  if (symbolCache.has(type)) return symbolCache.get(type);
  const ndb =
    '<circle cx="16" cy="16" r="11" stroke-dasharray="2 2"/><circle cx="16" cy="16" r="3"/>';
  const vor =
    '<path d="M16 3 27 9v14l-11 6L5 23V9Z"/><circle cx="16" cy="16" r="3"/>';
  const dme = '<path d="M5 5h22v22H5Z"/><path d="M11 16h10m-5-5v10"/>';
  const image =
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><g fill="none" stroke="white" stroke-width="2">${type === 'DME' ? dme : String(type).startsWith('NDB') ? ndb : vor}${String(type).includes('DME') && type !== 'DME' ? '<path d="M3 3h26v26H3Z"/>' : ''}</g></svg>`,
    );
  symbolCache.set(type, image);
  return image;
}
export function navaidDetailRows(a, p, t = (v) => v) {
  return [
    [msg('Navaid'), a.name],
    [msg('OurAirports ID'), a.id],
    [msg('Ident'), a.ident],
    [msg('Type'), a.type],
    [msg('Country'), a.country || a.countryCode],
    [msg('Coordinates'), `${a.lat}, ${a.lon}`],
    [msg('Frequency'), formatNavaidFrequency(a.frequencyKhz, a.type)],
    [msg('DME frequency'), formatNavaidFrequency(a.dmeFrequencyKhz, 'DME')],
    [msg('DME channel'), a.dmeChannel],
    [
      msg('DME coordinates'),
      Number.isFinite(a.dmeLat) && Number.isFinite(a.dmeLon)
        ? `${a.dmeLat}, ${a.dmeLon}`
        : null,
    ],
    [msg('Elevation (m MSL)'), a.elevationM],
    [msg('DME elevation (m MSL)'), a.dmeElevationM],
    [msg('Magnetic variation (degrees)'), a.magneticVariationDeg],
    [msg('Slaved variation (degrees)'), a.slavedVariationDeg],
    [msg('Usage'), a.usageType],
    [msg('Transmitter power'), a.power],
    [msg('Associated airport'), a.associatedAirport],
    [msg('Source'), p.source],
    [msg('Source URL'), p.sourceUrl],
    [msg('Revision'), p.revision],
    [msg('Updated'), p.updatedAt],
  ].map(([k, v]) => [t(k), v]);
}
/** Compact station facts for the shared airport dialog; provenance stays in context. */
export function navaidReadout(
  a,
  p,
  t = (v) => v,
  locale = 'en',
  countryFlagUrl = () => null,
) {
  const excluded = new Set([
    'Navaid',
    'OurAirports ID',
    'Ident',
    'Source',
    'Source URL',
    'Revision',
    'Updated',
  ]);
  let country = a.country || a.countryCode;
  try {
    if (/^[A-Z]{2}$/.test(a.countryCode))
      country =
        new Intl.DisplayNames([locale], { type: 'region' }).of(a.countryCode) ||
        country;
  } catch {
    /* Keep the directory value when region names are unavailable. */
  }
  return {
    category: msg('Navaid'),
    title: a.name || a.ident || t('Navaid'),
    symbol: navaidSymbol(a.type),
    codes: a.ident ? [{ label: t('Ident'), value: a.ident }] : [],
    countryFlag: countryFlagUrl({
      countryCode: a.countryCode,
      countryName: a.country,
    }),
    rows: navaidDetailRows(a, p)
      .filter(
        ([label, value]) =>
          !excluded.has(label) &&
          value !== null &&
          value !== undefined &&
          value !== '',
      )
      .map(([label, value]) => [label, label === 'Country' ? country : value]),
  };
}
const escape = (v) =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
export function countryLabelPoint(feature, decimals = 3) {
  return (
    (feature.polygons || [])
      .map((polygon) =>
        countryPolygonPoint({ ...feature, polygons: [polygon] }, decimals),
      )
      .filter(Boolean)
      .sort((a, b) => b.area - a.area)[0] || null
  );
}
function countryPolygonPoint(feature, decimals = 3) {
  const encoded = feature.polygons?.[0]?.[0];
  if (!encoded?.length) return null;
  let x = 0,
    y = 0;
  const ring = [];
  const f = 10 ** (feature.d ?? decimals);
  for (let i = 0; i + 1 < encoded.length; i += 2) {
    x += encoded[i];
    y += encoded[i + 1];
    ring.push([x / f, y / f]);
  }
  const ref = ring[0][0];
  for (const p of ring) p[0] -= 360 * Math.round((p[0] - ref) / 360);
  let area = 0,
    cx = 0,
    cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j],
      b = ring[i],
      v = a[0] * b[1] - b[0] * a[1];
    area += v;
    cx += (a[0] + b[0]) * v;
    cy += (a[1] + b[1]) * v;
  }
  let lon = area ? cx / (3 * area) : ring[0][0],
    lat = area ? cy / (3 * area) : ring[0][1];
  return {
    lon: ((((lon + 180) % 360) + 360) % 360) - 180,
    lat,
    area: Math.abs(area),
  };
}
const inside = (a, b) =>
  !b ||
  (a.lat >= b.south &&
    a.lat <= b.north &&
    (b.west <= b.east
      ? a.lon >= b.west && a.lon <= b.east
      : a.lon >= b.west || a.lon <= b.east));
export function createAviationReferences({
  source,
  overlayHost,
  registerEntityContext = () => {},
  removeEntityContextsForLayer = () => {},
  clearSelectedEntityContextForLayer = () => {},
  selectEntityContext = () => {},
  getPalette = () => null,
  getGroundHeight = () => null,
  t = (v) => v,
  getLocale = () => 'en',
  refreshSelectedReadout = () => {},
  isPointerFree = () => true,
  createInputHandler = (c) => new Cesium.ScreenSpaceEventHandler(c),
  governorRequestRender = () => {},
  loadCountries = (signal) =>
    loadBundledJson(
      new URL(
        '../../data/local_data/natural_earth/countries.json',
        import.meta.url,
      ),
      { signal },
    ),
  countryFlagUrl = () => null,
} = {}) {
  let viewer,
    data,
    enabled = false,
    controller,
    generation = 0,
    click,
    navEntries = [],
    countryEntries = [],
    countryCache = null,
    error = null,
    navaidMetadata = {};
  const accent = () =>
    getPalette()?.primaryOnDark || getPalette()?.primary || '#ffffff';
  const render = () => {
    viewer?.scene?.requestRender?.();
    governorRequestRender();
  };
  const publish = () => {
    overlayHost.setEntries(NAV, navEntries, {
      cohortLimit: 64,
      collisionCapacity: 64,
      moving: false,
    });
    overlayHost.setEntries(COUNTRY, countryEntries, {
      cohortLimit: 64,
      collisionCapacity: 64,
      moving: false,
    });
    render();
  };
  const api = {
    init(v) {
      viewer = v;
      data = new Cesium.CustomDataSource(NAV);
      data.show = false;
      viewer.dataSources.add(data);
    },
    enable() {
      enabled = true;
      data.show = true;
      for (const id of [NAV, COUNTRY]) overlayHost.setVisible(id, true);
      if (typeof source?.getNavaids === 'function' && viewer.scene?.canvas) {
        click = createInputHandler(viewer.scene.canvas);
        click.setInputAction((e) => {
          if (!enabled || !isPointerFree()) return;
          const entity = viewer.scene.pick(e.position)?.id;
          if (entity && data.entities.getById(entity.id) === entity) {
            viewer.selectedEntity = entity;
            selectEntityContext(entity);
            render();
          }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      }
    },
    async update({ bounds, height = Infinity } = {}) {
      if (!enabled) return false;
      controller?.abort();
      controller = new AbortController();
      const own = controller,
        gen = ++generation,
        locale = getLocale();
      const valid = () =>
        enabled &&
        !own.signal.aborted &&
        gen === generation &&
        getLocale() === locale;
      const tasks = [];
      if (typeof source?.getNavaids === 'function')
        tasks.push(
          (async () => {
            if (height > 750000) {
              if (valid()) {
                clearSelectedEntityContextForLayer(NAV);
                removeEntityContextsForLayer(NAV);
                if (
                  viewer.selectedEntity &&
                  data.entities.contains(viewer.selectedEntity)
                )
                  viewer.selectedEntity = undefined;
                data.entities.removeAll();
                navEntries = [];
              }
              return;
            }
            const result = await source.getNavaids({
              bounds,
              limit: 600,
              signal: own.signal,
            });
            if (!valid()) return;
            navaidMetadata = {
              navaidTotal: result.total ?? null,
              navaidMatched: result.matched ?? result.navaids?.length ?? 0,
              navaidTruncated:
                result.truncated === true ||
                (result.navaids?.length || 0) > 600,
              navaidRevision: result.revision,
              navaidUpdatedAt: result.updatedAt,
            };
            const records = (result.navaids || [])
                .filter(
                  (a) =>
                    Number.isFinite(a.lat) &&
                    Math.abs(a.lat) <= 90 &&
                    Number.isFinite(a.lon) &&
                    Math.abs(a.lon) <= 180 &&
                    inside(a, bounds),
                )
                .slice(0, 600),
              ids = new Set();
            navEntries = [];
            for (const [i, a] of records.entries()) {
              const id = `navaid:${a.id}`;
              ids.add(id);
              const p = {
                  ...a,
                  source: result.source || 'OurAirports',
                  sourceUrl: result.sourceUrl,
                  revision: result.revision,
                  updatedAt: result.updatedAt,
                },
                rows = navaidDetailRows(a, p),
                navaidFlag = countryFlagUrl({
                  countryCode: a.countryCode,
                  countryName: a.country,
                });
              let h = getGroundHeight(a.lat, a.lon);
              if (!Number.isFinite(h))
                h = viewer.scene?.globe?.getHeight?.(
                  Cesium.Cartographic.fromDegrees(a.lon, a.lat),
                );
              const position = Cesium.Cartesian3.fromDegrees(
                a.lon,
                a.lat,
                Number.isFinite(h) ? h : 0,
              );
              const entity =
                data.entities.getById(id) ||
                data.entities.add(new Cesium.Entity({ id }));
              Object.assign(entity, {
                name: a.name,
                position,
                description: `<table>${rows
                  .map(
                    ([k, v]) =>
                      `<tr><th>${escape(t(k))}</th><td>${k === 'Country' && navaidFlag ? `<img class="country-flag" src="${escape(navaidFlag)}" alt="" aria-hidden="true">` : ''}${escape(v ?? t('Unknown'))}</td></tr>`,
                  )
                  .join('')}</table>`,
                billboard: {
                  image: navaidSymbol(a.type),
                  width: 12,
                  height: 12,
                  color: Cesium.Color.fromCssColorString(accent()),
                  heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                  disableDepthTestDistance: 50000,
                },
                properties: { navaidId: a.id },
              });
              entity.gevTrackedId = id;
              entity.getAirportReadout = () =>
                navaidReadout(a, p, t, getLocale(), countryFlagUrl);
              entity.gevDisplayPosition = () => position;
              entity.gevLabelModel = {
                title: a.name,
                details: entity
                  .getAirportReadout()
                  .rows.map(([k, v]) => `${t(k)}: ${v}`),
                accent: accent(),
                anchorRadiusScale: null,
                placement: 'right',
                verticalOnly: false,
              };
              registerEntityContext(entity, {
                id,
                layerId: NAV,
                ownerLayerId: 'airports',
                layerName: 'Airports',
                label: a.name,
                source: p.source,
                latitude: a.lat,
                longitude: a.lon,
                properties: p,
              });
              refreshSelectedReadout(entity);
              if (i < 64)
                navEntries.push({
                  id,
                  position,
                  title: a.ident || a.name,
                  variant: 'label',
                  accent: accent(),
                  priority: 600 - i,
                  collisionGroup: 'ambient-label',
                  paintLane: 'ambient-label',
                  interactive: false,
                  horizonCull: true,
                  terrainOcclusion: false,
                  placement: 'above',
                  gapPx: 12,
                });
            }
            for (const e of [...data.entities.values])
              if (!ids.has(e.id)) {
                if (viewer.selectedEntity === e)
                  viewer.selectedEntity = undefined;
                data.entities.remove(e);
              }
            removeEntityContextsForLayer(NAV, { retainIds: ids });
          })(),
        );
      if (typeof source?.getCountries === 'function')
        tasks.push(
          (async () => {
            if (height < 750000) {
              if (valid()) countryEntries = [];
              return;
            }
            if (!countryCache || countryCache.locale !== locale) {
              const [result, pack] = await Promise.all([
                source.getCountries({ signal: own.signal }),
                loadCountries(own.signal),
              ]);
              if (!valid()) return;
              countryCache = { result, pack, locale };
            }
            if (!valid()) return;
            const { result, pack } = countryCache;
            const countries = new Map(
              (result.countries || []).map((c) => [c.code || c.countryCode, c]),
            );
            let names;
            try {
              names = new Intl.DisplayNames([getLocale()], { type: 'region' });
            } catch {}
            const seenCountries = new Set();
            countryEntries = pack.features
              .map((f) => {
                const p = countryLabelPoint(f, pack.meta?.decimals ?? 3);
                const record = countries.get(f.iso2);
                if (!p || !record || !inside(p, bounds)) return null;
                let title;
                try {
                  title = names?.of(f.iso2);
                } catch {}
                return {
                  countryCode: f.iso2,
                  id: `country:${f.iso2}:${f.name}`,
                  position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
                  title: title || record.name || f.name,
                  variant: 'label',
                  accent: accent(),
                  priority: p.area,
                  collisionGroup: 'ambient-label',
                  paintLane: 'ambient-label',
                  interactive: false,
                  horizonCull: true,
                  terrainOcclusion: false,
                };
              })
              .filter(Boolean)
              .sort((a, b) => b.priority - a.priority)
              .filter((e) => {
                if (seenCountries.has(e.countryCode)) return false;
                seenCountries.add(e.countryCode);
                return true;
              })
              .slice(0, 64);
          })(),
        );
      const results = await Promise.allSettled(tasks);
      if (!valid()) return false;
      error =
        results.find((r) => r.status === 'rejected')?.reason?.message || null;
      publish();
      return !error;
    },
    refreshTheme() {
      if (!enabled) return;
      for (const e of data.entities.values) {
        e.billboard.color = Cesium.Color.fromCssColorString(accent());
        e.gevLabelModel = { ...e.gevLabelModel, accent: accent() };
        refreshSelectedReadout(e);
      }
      navEntries = navEntries.map((e) => ({ ...e, accent: accent() }));
      countryEntries = countryEntries.map((e) => ({ ...e, accent: accent() }));
      publish();
    },
    disable() {
      enabled = false;
      ++generation;
      controller?.abort();
      click?.destroy();
      click = null;
      if (data) {
        if (
          viewer.selectedEntity &&
          data.entities.contains(viewer.selectedEntity)
        )
          viewer.selectedEntity = undefined;
        data.show = false;
        data.entities.removeAll();
      }
      clearSelectedEntityContextForLayer(NAV);
      removeEntityContextsForLayer(NAV);
      navEntries = [];
      countryEntries = [];
      for (const id of [NAV, COUNTRY]) {
        overlayHost.clearSource(id);
        overlayHost.setVisible(id, false);
      }
      render();
    },
    destroy() {
      api.disable();
      if (data) viewer?.dataSources.remove(data, true);
      data = null;
      viewer = null;
      countryCache = null;
    },
    getStats() {
      return {
        navaidCount: data?.entities.values.length || 0,
        countryCount: countryEntries.length,
        referenceError: error,
        ...navaidMetadata,
      };
    },
  };
  return api;
}
