import { createAirportsLayer } from '../../layers/airports/index.js';
import { overlayHost } from './overlayHost.js';
import {
  registerEntityContext,
  removeEntityContextsForLayer,
  clearSelectedEntityContextForLayer,
  selectEntityContext,
} from '../../data/contextStore.js';
import { getActivePalette } from '../../ui/colorSystemRuntime.js';
import { governorRequestRender } from '../../renderGovernor.js';
import { t, getLocale } from '../../i18n/index.js';
import { refreshTrackedReadout } from '../../data/trackedReadout.js';
import { countryFlagUrl } from '../../data/countryFlag.js';
/** Bind the portable airport layer to existing application presentation services. */
export function createApplicationAirports({ surface, ...options }) {
  return createAirportsLayer({
    overlayHost,
    registerEntityContext,
    removeEntityContextsForLayer,
    clearSelectedEntityContextForLayer,
    selectEntityContext,
    getPalette: getActivePalette,
    refreshSelectedReadout: refreshTrackedReadout,
    subscribeTheme: (listener) => {
      const root = globalThis.document?.documentElement;
      if (!root || typeof MutationObserver === 'undefined') return null;
      const observer = new MutationObserver(listener);
      observer.observe(root, { attributes: true, attributeFilter: ['style'] });
      return () => observer.disconnect();
    },
    getGroundHeight: (lat, lon) =>
      surface?.groundFloor?.cachedGroundFloor(lat, lon),
    governorRequestRender,
    getLocale,
    t,
    countryFlagUrl,
    ...options,
  });
}
