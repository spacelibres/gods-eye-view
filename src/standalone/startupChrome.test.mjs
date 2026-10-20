import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(
  new URL('../app/startupChrome.js', import.meta.url),
  'utf8',
)
  .replace(/^import .*;\n/gm, '')
  .replace(/^export /gm, '');

function fixture({ viewer = null, tileset = null } = {}) {
  const timers = new Map();
  const listeners = new Map();
  const events = [];
  let restored;
  let nextTimer = 0;
  const controller = new AbortController();
  const context = {
    console,
    setTimeout(fn, delay) {
      const id = ++nextTimer;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    initFirstRunExperience() {
      events.push('welcome');
      return { destroy: () => events.push('welcome:destroy') };
    },
    async initKeySetup() {
      return { destroy: () => events.push('settings:destroy') };
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const stop = context.startApplicationChrome({
    initializeSettings: context.initKeySetup,
    loadingScreen: {
      classList: { add: (value) => events.push(value) },
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type) => listeners.delete(type),
    },
    styleManager: {
      initialRestorePromise: new Promise((resolve) => {
        restored = resolve;
      }),
    },
    dataManager: {},
    viewer,
    tileset,
    signal: controller.signal,
  });
  return {
    events,
    listeners,
    stop,
    restored,
    controller,
    fire(delay) {
      for (const [id, task] of timers) {
        if (task.delay === delay) {
          timers.delete(id);
          task.fn();
        }
      }
    },
    timers,
  };
}
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

test('welcome waits for restoration, minimum delay, and the cover transition', async () => {
  const f = fixture();
  f.fire(1000);
  await flush();
  assert.deepEqual(f.events, []);
  f.restored();
  await flush();
  assert.deepEqual(f.events, ['hidden']);
  f.listeners.get('transitionend')();
  f.fire(900);
  assert.deepEqual(f.events, ['hidden', 'welcome']);
  await f.stop();
  assert.deepEqual(f.events.slice(-2), ['welcome:destroy', 'settings:destroy']);
  assert.equal(f.timers.size, 0);
});

test('reduced motion uses the bounded fallback after the cover hides', async () => {
  const f = fixture();
  f.restored();
  f.fire(1000);
  await flush();
  f.fire(900);
  assert.deepEqual(f.events, ['hidden', 'welcome']);
  await f.stop();
});

test('shutdown while restore is pending never reveals late welcome UI', async () => {
  const f = fixture();
  f.controller.abort();
  await f.stop();
  f.restored();
  await flush();
  f.fire(1000);
  f.fire(900);
  assert.deepEqual(f.events, ['settings:destroy']);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.timers.size, 0);
});

test('shutdown during the cover transition cancels the listener and fallback', async () => {
  const f = fixture();
  f.restored();
  f.fire(1000);
  await flush();
  const transition = f.listeners.get('transitionend');
  f.controller.abort();
  await f.stop();
  transition();
  f.fire(900);
  assert.deepEqual(f.events, ['hidden', 'settings:destroy']);
});

/** A viewer whose globe reports tile progress the test controls. */
function globeViewer({ tilesLoaded = false } = {}) {
  const listeners = new Set();
  const globe = {
    tilesLoaded,
    tileLoadProgressEvent: {
      addEventListener: (listener) => listeners.add(listener),
      removeEventListener: (listener) => listeners.delete(listener),
    },
  };
  return {
    viewer: { scene: { globe } },
    progress(remaining) {
      for (const listener of [...listeners]) listener(remaining);
    },
    listenerCount: () => listeners.size,
  };
}

test('the cover waits for the base map to stop loading tiles', async () => {
  const g = globeViewer();
  const f = fixture({ viewer: g.viewer });
  f.restored();
  f.fire(1000);
  await flush();
  // Restoration and the minimum delay are both done, but tiles are still in
  // flight: the page stays covered.
  assert.deepEqual(f.events, []);

  g.progress(3);
  await flush();
  assert.deepEqual(f.events, [], 'a partial count is not the end');

  g.progress(0);
  await flush();
  assert.deepEqual(f.events, ['hidden']);
  assert.equal(g.listenerCount(), 0, 'the tile listener is released');
  await f.stop();
});

test('an already-loaded base map does not hold the cover', async () => {
  const g = globeViewer({ tilesLoaded: true });
  const f = fixture({ viewer: g.viewer });
  f.restored();
  f.fire(1000);
  await flush();
  assert.deepEqual(f.events, ['hidden']);
  await f.stop();
});

test('a slow base map is bounded so the app still opens', async () => {
  const g = globeViewer();
  const f = fixture({ viewer: g.viewer });
  f.restored();
  f.fire(1000);
  await flush();
  assert.deepEqual(f.events, []);

  // The deadline timer fires and the cover lifts anyway.
  f.fire(12000);
  await flush();
  assert.deepEqual(f.events, ['hidden']);
  assert.equal(g.listenerCount(), 0, 'the tile listener is released');
  await f.stop();
});

/** A photoreal tileset, which draws as a primitive while the globe is hidden. */
function photorealTileset({ tilesLoaded = false } = {}) {
  const listeners = new Set();
  return {
    tilesLoaded,
    allTilesLoaded: {
      addEventListener: (listener) => listeners.add(listener),
      removeEventListener: (listener) => listeners.delete(listener),
    },
    fireAllLoaded() {
      for (const listener of [...listeners]) listener();
    },
    listenerCount: () => listeners.size,
  };
}

test('photoreal tiles gate the cover through allTilesLoaded', async () => {
  // The globe is hidden in this mode and reports nothing in flight, so a
  // globe-only check would lift the cover before the planet was drawn.
  const g = globeViewer({ tilesLoaded: true });
  const tileset = photorealTileset();
  const f = fixture({ viewer: g.viewer, tileset });
  f.restored();
  f.fire(1000);
  await flush();
  assert.deepEqual(f.events, [], 'the cover stays until the tileset lands');

  tileset.fireAllLoaded();
  await flush();
  assert.deepEqual(f.events, ['hidden']);
  assert.equal(tileset.listenerCount(), 0);
  await f.stop();
});
