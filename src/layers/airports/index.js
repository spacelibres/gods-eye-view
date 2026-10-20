import { createAviationReferences } from './references.js';
import * as Cesium from 'cesium';
import { isPointerFree as pointerFree } from '../../data/inputOwnership.js';
import {
  AIRPORT_LABEL_LIMIT,
  AIRPORT_POINT_LIMIT,
  airportTypesForHeight,
  selectAirports,
  airportContext,
  airportDescription,
  airportDetailRows,
  airportSymbol,
  airportLegend,
  resolveAirportUsage,
} from './model.js';
export * from './model.js';
const msg = (value) => value;
/** One viewport-scoped, bounded directory display. MSL elevation is metadata only. */
export function createAirportsLayer({
  source,
  overlayHost,
  registerEntityContext = () => {},
  removeEntityContextsForLayer = () => {},
  clearSelectedEntityContextForLayer = () => {},
  selectEntityContext = () => {},
  isPointerFree = pointerFree,
  createInputHandler = (canvas) => new Cesium.ScreenSpaceEventHandler(canvas),
  getGroundHeight = () => null,
  subscribeTheme = () => null,
  refreshSelectedReadout = () => {},
  getPalette = () => null,
  t = (value) => value,
  governorRequestRender = () => {},
  getLocale = () => 'en',
  loadCountries,
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Airports require a snapshot source');
  if (!overlayHost) throw new TypeError('Airports require an overlay host');
  let viewer = null,
    data = null,
    enabled = false,
    request = null,
    pending = null,
    requestKey = null,
    removeMove = null,
    records = [],
    lastUpdate = null,
    error = null,
    metadata = {},
    rowListener = null,
    clickHandler = null,
    removeTheme = null,
    overlayEntries = [];
  const references = createAviationReferences({
    source,
    overlayHost,
    registerEntityContext,
    removeEntityContextsForLayer,
    clearSelectedEntityContextForLayer,
    selectEntityContext,
    isPointerFree,
    createInputHandler,
    getGroundHeight,
    refreshSelectedReadout,
    getPalette,
    t,
    governorRequestRender,
    getLocale,
    loadCountries,
  });
  const accentColor = () => {
    const palette = getPalette();
    return (
      palette?.primaryOnDark ||
      palette?.primary ||
      Cesium.Color.WHITE.toCssColorString()
    );
  };
  function refreshTheme() {
    if (!enabled || !data) return;
    references.refreshTheme();
    const accent = accentColor();
    for (const entity of data.entities.values) {
      entity.billboard.color = Cesium.Color.fromCssColorString(accent);
      entity.gevLabelModel = { ...entity.gevLabelModel, accent };
      refreshSelectedReadout(entity);
    }
    overlayEntries = overlayEntries.map((entry) => ({ ...entry, accent }));
    overlayHost.setEntries('airports', overlayEntries, {
      cohortLimit: AIRPORT_LABEL_LIMIT,
      collisionCapacity: 48,
      moving: false,
    });
    render();
  }
  const render = () => {
    viewer?.scene?.requestRender?.();
    governorRequestRender();
    rowListener?.();
  };
  const clear = () => {
    clearSelectedEntityContextForLayer('airports');
    removeEntityContextsForLayer('airports');
    overlayHost.clearSource('airports');
  };
  function query() {
    const rectangle = viewer.camera.computeViewRectangle?.(
      viewer.scene?.globe?.ellipsoid,
    );
    const bounds = rectangle
      ? Object.fromEntries(
          ['west', 'south', 'east', 'north'].map((k) => [
            k,
            Cesium.Math.toDegrees(rectangle[k]),
          ]),
        )
      : { west: -180, south: -90, east: 180, north: 90 };
    return {
      bounds,
      types: airportTypesForHeight(
        viewer.camera.positionCartographic?.height ?? Infinity,
      ),
      limit: AIRPORT_POINT_LIMIT,
    };
  }
  const layer = {
    id: 'airports',
    name: 'Airports',
    icon: '✈',
    source: 'OurAirports',
    updateInterval: 60000,
    init(nextViewer) {
      if (viewer) throw Error('Airport layer already initialized');
      viewer = nextViewer;
      data = new Cesium.CustomDataSource('airports');
      data.show = false;
      viewer.dataSources.add(data);
      overlayHost.setVisible('airports', false);
      references.init(viewer);
    },
    enable() {
      if (!viewer || enabled) return;
      enabled = true;
      references.enable();
      data.show = true;
      overlayHost.setVisible('airports', true);
      removeTheme = subscribeTheme(refreshTheme);
      removeMove = viewer.camera.moveEnd?.addEventListener(() => {
        void layer.update();
      });
      if (viewer.scene?.canvas) {
        clickHandler = createInputHandler(viewer.scene.canvas);
        clickHandler.setInputAction((click) => {
          if (!enabled || !isPointerFree()) return;
          const entity = viewer.scene.pick(click.position)?.id;
          if (!entity || data.entities.getById(entity.id) !== entity) return;
          viewer.selectedEntity = entity;
          selectEntityContext(entity);
          render();
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      }
      void layer.update();
    },
    disable() {
      references.disable();
      enabled = false;
      request?.abort();
      request = null;
      pending = null;
      requestKey = null;
      removeMove?.();
      removeMove = null;
      removeTheme?.();
      removeTheme = null;
      overlayEntries = [];
      clickHandler?.destroy();
      clickHandler = null;
      if (data) {
        data.show = false;
        data.entities.removeAll();
      }
      records = [];
      clear();
      overlayHost.setVisible('airports', false);
      render();
    },
    update() {
      if (!enabled || !data) return Promise.resolve(false);
      const options = query();
      const key = JSON.stringify(options);
      if (request && requestKey === key) return pending;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      requestKey = key;
      const referenceUpdate = references.update({
        bounds: options.bounds,
        height: viewer.camera.positionCartographic?.height ?? Infinity,
      });
      pending = (async () => {
        try {
          const snapshot = await source.getSnapshot({
            ...options,
            signal: controller.signal,
          });
          if (controller.signal.aborted || request !== controller || !enabled)
            return false;
          const next = selectAirports(snapshot.airports, options.types);
          const accent = accentColor();
          const color = Cesium.Color.fromCssColorString(accent);
          const entries = [];
          const contexts = [];
          const entities = next.map((a, i) => {
            const usage = resolveAirportUsage(a);
            const symbol = airportSymbol(a, usage.kind);
            const context = airportContext(a, snapshot);
            // Directory elevations are MSL, never render heights. Use the same
            // cached ellipsoidal surface floor as other application geometry.
            const cachedHeight = getGroundHeight(a.lat, a.lon);
            const terrainHeight = Number.isFinite(cachedHeight)
              ? cachedHeight
              : viewer.scene?.globe?.getHeight?.(
                  Cesium.Cartographic.fromDegrees(a.lon, a.lat),
                );
            const position = Cesium.Cartesian3.fromDegrees(
              a.lon,
              a.lat,
              Number.isFinite(terrainHeight) ? terrainHeight : 0,
            );
            // Retain stable carriers: shared selection/readout holds the Entity
            // itself, so replacing it would strand the selected detail card.
            const entity =
              data.entities.getById(context.id) ||
              new Cesium.Entity({ id: context.id });
            Object.assign(entity, {
              name: a.name,
              position,
              description: airportDescription(a, context.properties, t),
              billboard: {
                image: symbol.image,
                width:
                  a.type === 'large_airport'
                    ? 28
                    : a.type === 'medium_airport'
                      ? 24
                      : 20,
                height:
                  a.type === 'large_airport'
                    ? 28
                    : a.type === 'medium_airport'
                      ? 24
                      : 20,
                color,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: 50000,
              },
              properties: {
                airportId: a.id,
                airportSymbol: symbol.kind,
                airportUsage: usage.kind,
              },
            });
            entity.gevTrackedId = context.id;
            entity.gevDisplayPosition = () => position;
            entity.gevLabelModel = {
              title: a.name,
              details: airportDetailRows(a, context.properties, t)
                .filter(
                  ([label]) =>
                    !['Usage evidence', 'Usage source URL'].includes(label),
                )
                .slice(1)
                .map(
                  ([label, value]) =>
                    `${t(label)}: ${value === null || value === undefined || value === '' ? t('Unknown') : value}`,
                ),
              accent,
              anchorRadiusScale: null,
              placement: 'right',
              verticalOnly: false,
            };
            contexts.push([entity, context]);
            if (i < AIRPORT_LABEL_LIMIT)
              entries.push({
                id: a.id,
                position,
                variant: 'label',
                title: a.iataCode || a.icaoCode || a.name,
                accent,
                priority: AIRPORT_POINT_LIMIT - i,
                collisionGroup: 'ambient-label',
                paintLane: 'ambient-label',
                interactive: false,
                horizonCull: true,
                terrainOcclusion: false,
                edgeFade: 'keyhole',
                gapPx: 12,
                placement: 'above',
              });
            return entity;
          });
          const retainIds = new Set(entities.map((entity) => entity.id));
          for (const entity of [...data.entities.values]) {
            if (!retainIds.has(entity.id)) {
              if (viewer.selectedEntity === entity)
                viewer.selectedEntity = undefined;
              data.entities.remove(entity);
            }
          }
          for (const entity of entities) {
            if (!data.entities.contains(entity)) data.entities.add(entity);
            refreshSelectedReadout(entity);
          }
          for (const [entity, context] of contexts)
            registerEntityContext(entity, context);
          removeEntityContextsForLayer('airports', {
            retainIds: new Set(contexts.map(([, c]) => c.id)),
          });
          overlayHost.setEntries('airports', entries, {
            cohortLimit: AIRPORT_LABEL_LIMIT,
            collisionCapacity: 48,
            moving: false,
          });
          overlayEntries = entries;
          records = next;
          metadata = {
            revision: snapshot.revision,
            updatedAt: snapshot.updatedAt,
            total: snapshot.total,
            matched: snapshot.matched,
            truncated:
              snapshot.truncated === true ||
              snapshot.airports.length > next.length,
          };
          await referenceUpdate;
          if (controller.signal.aborted || request !== controller || !enabled)
            return false;
          lastUpdate = Date.now();
          error = null;
          render();
          return true;
        } catch (e) {
          if (!controller.signal.aborted && request === controller && enabled)
            error = e?.message || msg('Airport source unavailable');
          return false;
        } finally {
          if (request === controller) {
            request = null;
            pending = null;
            requestKey = null;
          }
        }
      })();
      return pending;
    },
    destroy() {
      layer.disable();
      references.destroy();
      if (data) viewer?.dataSources.remove(data, true);
      data = null;
      viewer = null;
      lastUpdate = null;
      error = null;
      metadata = {};
      rowListener = null;
    },
    getStats() {
      return {
        count: records.length,
        lastUpdate,
        error,
        ...metadata,
        ...references.getStats(),
      };
    },
    getRowControls() {
      const ref = references.getStats();
      const status = error
        ? msg('Airport source unavailable')
        : ref.referenceError
          ? msg('Aviation reference source unavailable')
          : metadata.truncated || ref.navaidTruncated
            ? msg('Airport display limited')
            : msg('Airport directory');
      return {
        readout: false,
        legend: enabled ? airportLegend(records, t, accentColor()) : [],
        info: `${t(status)} · ${records.length} / ${metadata.matched || 0} · ${t('Navaids')}: ${ref.navaidCount} / ${ref.navaidMatched || 0} · ${t('Countries')}: ${references.getStats().countryCount}`,
        summary: {
          label: t('Airports'),
          coverage: t('Current viewport'),
          validTime: metadata.updatedAt,
          detail: `OurAirports · ${metadata.revision || t('Unknown')}`,
          status: t(status),
          units: t('Facilities'),
        },
      };
    },
    setRowControlsListener(listener) {
      rowListener = typeof listener === 'function' ? listener : null;
    },
    getAnalystRecords(maxCount = AIRPORT_POINT_LIMIT) {
      return enabled
        ? records
            .slice(
              0,
              Math.max(
                0,
                Math.min(
                  AIRPORT_POINT_LIMIT,
                  Number.isFinite(maxCount)
                    ? Math.floor(maxCount)
                    : AIRPORT_POINT_LIMIT,
                ),
              ),
            )
            .map((a) => ({ ...a }))
        : [];
    },
  };
  return layer;
}
