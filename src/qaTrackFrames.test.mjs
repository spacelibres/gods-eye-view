import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(
  new URL('../scripts/track-regression.mjs', import.meta.url),
  'utf8',
);
const sampler = source.slice(
  source.indexOf('async function sampleFrames('),
  source.indexOf('\nfunction sleep(ms)'),
);

function fixture({ render = true } = {}) {
  const listeners = new Set(),
    rafs = new Map(),
    timers = new Map();
  let nextId = 0,
    requested = false,
    frame = 0;
  const scene = {
    requestRender() {
      requested = true;
    },
    postRender: {
      addEventListener(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
  };
  const context = vm.createContext({
    window: { __godsEyeView: { viewer: { scene } } },
    requestAnimationFrame(fn) {
      const id = ++nextId;
      rafs.set(id, fn);
      return id;
    },
    cancelAnimationFrame(id) {
      rafs.delete(id);
    },
    setTimeout(fn) {
      const id = ++nextId;
      timers.set(id, fn);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  });
  vm.runInContext(sampler, context);
  const page = {
    evaluate(fn, ...args) {
      context.args = args;
      return vm.runInContext(`(${fn.toString()})(...args)`, context);
    },
  };
  return {
    start: (n) => context.sampleFrames(page, n, () => 7),
    tick() {
      const callbacks = [...rafs.values()];
      rafs.clear();
      callbacks.forEach((fn) => fn());
      if (requested && render) {
        frame++;
        for (const fn of [...listeners]) fn();
        // Simulate a request coalesced/consumed by the current render. A
        // request issued only from postRender cannot guarantee another frame.
        requested = false;
      }
    },
    expire() {
      [...timers.values()].forEach((fn) => fn());
    },
    resources: () => ({
      listeners: listeners.size,
      rafs: rafs.size,
      timers: timers.size,
      frame,
    }),
  };
}

test('tracking sampler pumps every requested rendered frame despite coalesced render requests', async () => {
  const f = fixture();
  const result = f.start(60);
  for (let i = 0; i < 60; i++) f.tick();
  f.expire();
  const sampled = await result;
  assert.equal(sampled.timedOut, false);
  assert.equal(sampled.values.length, 60);
  assert.deepEqual(f.resources(), {
    listeners: 0,
    rafs: 0,
    timers: 0,
    frame: 60,
  });
});

test('tracking sampler timeout releases its frame pump and postRender subscription', async () => {
  const f = fixture({ render: false });
  const result = f.start(30);
  f.tick();
  f.expire();
  const sampled = await result;
  assert.equal(sampled.timedOut, true);
  assert.equal(sampled.values.length, 0);
  assert.deepEqual(f.resources(), {
    listeners: 0,
    rafs: 0,
    timers: 0,
    frame: 0,
  });
});

test('tracked ownership fixture seeds the current display cell after a taxi crosses the original grid', () => {
  const assignment =
    /window\.__dfSeedTrackedFloor = \(gf, c, heightM\) => \{[\s\S]*?\n      \};/.exec(
      source,
    )?.[0];
  assert.ok(
    assignment,
    'the moving tracked fixture needs a current-position seed',
  );
  const window = {};
  vm.runInNewContext(assignment, { window });
  const cells = new Map();
  const gf = {
    reportMeshFloorCell: (lat, lon, h) =>
      cells.set(`${lat.toFixed(3)},${lon.toFixed(3)}`, h),
  };
  window.__dfSeedTrackedFloor(gf, { lat: 30.3, lon: -97.8 }, 440);
  assert.equal(
    cells.get('30.300,-97.790'),
    undefined,
    'the original grid does not cover a long taxi',
  );
  window.__dfSeedTrackedFloor(gf, { lat: 30.3, lon: -97.79 }, 440);
  assert.equal(cells.get('30.300,-97.790'), 440);
  assert.equal(
    cells.get('30.300,-97.789'),
    440,
    'adjacent cell covers motion between the two render observations',
  );
});
