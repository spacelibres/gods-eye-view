import { initFirstRunExperience } from '../firstRunExperience.js';

/** Upper bound on the base-map wait, so a slow network still reaches the app. */
export const BASE_MAP_DEADLINE_MS = 12_000;

/** Reveal welcome controls only after restoration and the loading transition. */
export function startApplicationChrome({
  loadingScreen,
  styleManager,
  dataManager,
  viewer,
  tileset,
  signal,
  initializeWelcome = initFirstRunExperience,
  initializeSettings,
  reportStatus,
}) {
  let disposed = false;
  let firstRun;
  let revealTimer;
  let resolveDelay;
  const minimumDelay = new Promise((resolve) => {
    resolveDelay = resolve;
  });
  // Long enough that the screen is seen rather than flashed.
  const delayTimer = setTimeout(resolveDelay, 1000);
  const revealFirstRun = () => {
    if (disposed || signal.aborted || firstRun) return;
    firstRun = initializeWelcome?.({ styleManager, dataManager });
    clearTimeout(revealTimer);
    loadingScreen.removeEventListener('transitionend', revealFirstRun);
  };
  const report = (text) => {
    if (disposed || signal.aborted) return;
    reportStatus?.(text);
  };
  void Promise.all([
    styleManager.initialRestorePromise,
    minimumDelay,
    // The first frame is the base map. Everything else — the layer catalog,
    // the feeds — keeps loading behind the page, which is why this waits for
    // one thing and is bounded rather than exhaustive.
    waitForBaseMap(viewer, { tileset, signal, report }),
  ])
    .catch(() => {
      /* Restoration reports its own outcome through the controls. */
    })
    .then(() => {
      if (disposed || signal.aborted) return;
      loadingScreen.classList.add('hidden');
      loadingScreen.addEventListener('transitionend', revealFirstRun, {
        once: true,
      });
      revealTimer = setTimeout(revealFirstRun, 900);
    });
  const keySetup = Promise.resolve(
    signal.aborted ? null : initializeSettings?.({ signal }),
  );
  // Own the pending initializer too; it must not reveal a dialog after abort.
  void keySetup.catch(() =>
    console.error('Provider settings initialization failed'),
  );
  return async () => {
    disposed = true;
    clearTimeout(delayTimer);
    clearTimeout(revealTimer);
    resolveDelay();
    loadingScreen.removeEventListener('transitionend', revealFirstRun);
    firstRun?.destroy();
    (await keySetup.catch(() => null))?.destroy();
  };
}

/**
 * Resolve once the base map has finished its first load, or at the deadline.
 *
 * What counts as "the base map" depends on which one is drawing first:
 *
 * - Photoreal 3D tiles run as a primitive with the globe hidden, so the globe
 *   reports nothing in flight the whole time and would resolve at once.
 *   `tileset.allTilesLoaded` is the event that means its first screen is up.
 * - The keyless globe loads through its surface; `globe.tilesLoaded` turns
 *   false while tiles are queued and the progress event reports the count.
 *
 * A viewer with nothing to wait for resolves immediately: a warm cache has the
 * map already, and holding the loading screen would only delay a ready page.
 *
 * @param {object} [viewer] The Cesium viewer, if the scene produced one.
 * @param {{tileset?: object, signal?: AbortSignal,
 *   report?: (text: string) => void}} [options] `tileset` is the photoreal
 *   tileset when the scene added one; `report` receives the loader text.
 * @returns {Promise<'idle'|'deadline'|'absent'|'aborted'>}
 */
export function waitForBaseMap(viewer, { tileset, signal, report } = {}) {
  if (signal?.aborted) return Promise.resolve('aborted');
  if (tileset?.allTilesLoaded) {
    // Already drawn (a cached run) — nothing to wait for.
    if (tileset.tilesLoaded !== false) return Promise.resolve('idle');
    report?.('Finishing the base map...');
    return boundedWait(signal, (done) => {
      const finish = () => done('idle');
      tileset.allTilesLoaded.addEventListener(finish);
      return () => tileset.allTilesLoaded.removeEventListener(finish);
    });
  }

  const globe = viewer?.scene?.globe;
  if (!globe) return Promise.resolve('absent');
  if (!(globe.tilesLoaded === false)) return Promise.resolve('idle');
  report?.('Finishing the base map...');
  return boundedWait(signal, (done) => {
    const onProgress = (remaining) => {
      if (remaining > 0) return;
      done('idle');
    };
    globe.tileLoadProgressEvent?.addEventListener?.(onProgress);
    return () => globe.tileLoadProgressEvent?.removeEventListener?.(onProgress);
  });
}

/**
 * Run `subscribe`, which calls `done` when the map is ready, and give up at the
 * deadline. Always releases the subscription and the abort listener.
 */
function boundedWait(signal, subscribe) {
  return new Promise((resolve) => {
    let settled = false;
    let release = null;
    const finish = (reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      release?.();
      signal?.removeEventListener?.('abort', onAbort);
      resolve(reason);
    };
    const onAbort = () => finish('aborted');
    release = subscribe(finish);
    signal?.addEventListener?.('abort', onAbort, { once: true });
    const timer = setTimeout(() => finish('deadline'), BASE_MAP_DEADLINE_MS);
  });
}
