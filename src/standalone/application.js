import { createStandaloneCatalog } from './catalog.js';
import { createStandalonePlaceSearch } from './placeSearch.js';
import { CITY_POIS } from '../cityPois.js';
import { createApplication } from '../app/application.js';
import { createStandaloneScene } from './scene.js';
import { createStandaloneControls } from './controls.js';
import { createStandaloneData } from './data.js';
import { createStandaloneTools } from './tools.js';
import { resolveLocale, applyDocumentLanguage } from '../i18n/locale.js';
import {
  applyDocumentTranslations,
  getLocale,
  setLocale,
  t,
} from '../i18n/index.js';
import { initColorSystem } from '../ui/colorSystemRuntime.js';
import { chooseTileRoute } from '../maps/tileRoute.js';
import { mountBrandLockups } from '../ui/brandLockup.js';
import { createGoogleTokenSource } from '../maps/googleTokens.js';

// The existing controls and layer catalog contain page-scoped state.
let constructed = false;

/** Compose the standalone application once per page. Reload to start again. */
export function createStandaloneApplication({
  googleApiKey,
  cesiumToken,
  geospatial = {},
  voice = {},
  sources = {},
  streetLevelProviders,
  allowQaRegistration = false,
}) {
  if (constructed)
    throw new Error('The standalone application already owns this page');
  constructed = true;
  // Record which release this page is running. Assets are named after it, so
  // this is what turns "which files is this tab using?" into a one-line check
  // in DevTools (and the value a support report should quote).
  const appVersion = String(import.meta.env.APP_VERSION || 'dev');
  document.documentElement.dataset.appVersion = appVersion;
  // This is the first thing initialization does: ask whether this network can
  // reach Google at all. It starts here, before the palette, the locale and the
  // viewer, because nothing about the map should be built on an assumption the
  // network may contradict. The probe asks Google with the real key, so a 200
  // proves both the host is reachable and the key works. It runs in parallel
  // with the rest of the boot; only the tile request waits for it, and it has
  // a three-second deadline, so a blocked Google costs three seconds once and
  // a reachable one costs nothing.
  const googleRoute = googleApiKey
    ? chooseTileRoute({ apiKey: googleApiKey }).then((route) => {
        if (route === 'relayed') {
          console.info(
            '[Init] Google is unreachable from this network; tiles will be relayed.',
          );
        }
        return route;
      })
    : Promise.resolve('direct');
  // The identity palette is resolved before the UI is built, so the first
  // painted frame already carries the primary colour and its derived roles.
  // The pre-paint bootstrap has already written the roles, so this only keeps
  // them in step with the stored choice (and with ?primary=) before the UI is built.
  const palette = initColorSystem();
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', palette.deep);
  // The mark is a vector that follows the palette, so it is inlined rather
  // than loaded as an image. It is independent of the rest of the boot, so it
  // is not awaited.
  void mountBrandLockups(document);
  // Locale is resolved before any UI initialization so <html lang>/<html dir>
  // and every catalog lookup agree from the first painted frame. Module
  // scripts execute after parsing, so the DOM is ready here and every
  // data-i18n* element honors the resolved locale without a reload.
  const activeLocale = resolveLocale();
  setLocale(activeLocale);
  applyDocumentLanguage(document, activeLocale);
  applyDocumentTranslations(document);
  const loadingScreen = document.getElementById('loading-screen');
  const loaderStatus = loadingScreen.querySelector('.loader-status');
  // The probe is already in flight. Show it, then report what it found, so a
  // slow network shows progress rather than a still screen.
  if (googleApiKey) {
    const checking = t('Checking connectivity...');
    loaderStatus.textContent = checking;
    void googleRoute.then((route) => {
      if (loaderStatus.textContent !== checking) return;
      loaderStatus.textContent =
        route === 'relayed'
          ? t('Routing map data through the server...')
          : t('Loading Google 3D Tiles...');
    });
  }
  let placeSearch;
  let catalog;
  return createApplication({
    createScene: async (context) => {
      placeSearch = createStandalonePlaceSearch({
        // The bundled city and landmark data the offline name provider reads.
        // The search package takes it as plain data rather than importing it,
        // so it stays free of application state.
        presets: CITY_POIS,
        ...geospatial,
        resolveApiKey: () => googleApiKey,
        // Place names come back in the language the UI runs in.
        getLocale,
        signal: context.signal,
      });
      const scene = await createStandaloneScene({
        ...context,
        googleApiKey,
        googleRoute,
        // Without a key, Google 3D can still load with tokens from the
        // app's server when it offers them.
        googleTokens: googleApiKey ? null : createGoogleTokenSource(),
        cesiumToken,
        loaderStatus,
      });
      catalog = createStandaloneCatalog({
        sources,
        streetLevelProviders,
        nepalBoundaryResolver: (signal) =>
          scene.operations.annotationResolver.resolveRegionRingForQuery(
            'Nepal',
            signal,
            placeSearch,
            // The locator draws the border whenever it arrives.
            { budgetMs: Infinity },
          ),
        signal: context.signal,
        surface: scene.operations.surface,
      });
      return scene;
    },
    createControls: (context) =>
      createStandaloneControls({
        ...context,
        loaderStatus,
        placeSearch,
        catalog,
      }),
    createData: (context) =>
      createStandaloneData({ ...context, allowQaRegistration, catalog }),
    createTools: (context) =>
      createStandaloneTools({ ...context, loadingScreen, placeSearch, voice }),
  });
}
