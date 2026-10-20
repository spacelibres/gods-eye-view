import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MOBILE_PANEL_GROUPS,
  initMobilePanelSwitches,
} from './mobilePanelSwitches.js';

/** The smallest DOM the module touches: body, two groups, buttons. */
function makeDocument() {
  const created = [];
  const classes = new Map();
  const listeners = new Map();
  const panel = (id) => {
    const set = new Set();
    classes.set(id, set);
    return {
      id,
      classList: {
        contains: (name) => set.has(name),
        toggle: (name, force) => {
          if (force === undefined) {
            if (set.has(name)) set.delete(name);
            else set.add(name);
          } else if (force) set.add(name);
          else set.delete(name);
          return set.has(name);
        },
        add: (name) => set.add(name),
        remove: (name) => set.delete(name),
      },
      contains: () => false,
    };
  };
  const panels = Object.fromEntries(
    MOBILE_PANEL_GROUPS.map((group) => [group.id, panel(group.id)]),
  );
  const documentRef = {
    body: {
      appendChild: (node) => created.push(node),
    },
    getElementById: (id) => panels[id] ?? null,
    createElement: () => {
      const attributes = new Map();
      const handlers = new Map();
      const classes = new Set();
      return {
        dataset: {},
        attributes,
        innerHTML: '',
        type: '',
        className: '',
        classList: { add: (n) => classes.add(n), remove: (n) => classes.delete(n) },
        setAttribute: (name, value) => attributes.set(name, value),
        getAttribute: (name) => attributes.get(name) ?? null,
        addEventListener: (type, fn) => handlers.set(type, fn),
        removeEventListener: (type) => handlers.delete(type),
        remove: () => created.splice(created.indexOf(this), 1),
        click: () => handlers.get('click')?.({ preventDefault() {} }),
        contains: (target) => target === null,
      };
    },
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  return { documentRef, created, panels, listeners };
}

const desktopQuery = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});

test('one thumb-sized switch is mounted per panel group', () => {
  const { documentRef, created } = makeDocument();
  const switches = initMobilePanelSwitches({
    documentRef,
    matchMedia: desktopQuery,
  });
  assert.equal(created.length, MOBILE_PANEL_GROUPS.length);
  for (const group of MOBILE_PANEL_GROUPS) {
    const button = created.find((b) => b.dataset.panelGroup === group.id);
    assert.ok(button, `${group.id} has a switch`);
    assert.equal(button.getAttribute('aria-controls'), group.id);
    assert.equal(button.getAttribute('aria-expanded'), 'false');
  }
  switches.destroy();
  assert.equal(documentRef.body && created.length, 0);
});

test('tapping a switch opens its group and closes it again', () => {
  const { documentRef, created, panels } = makeDocument();
  initMobilePanelSwitches({ documentRef, matchMedia: desktopQuery });
  const button = created.find(
    (b) => b.dataset.panelGroup === 'left-panel-stack',
  );
  const group = panels['left-panel-stack'];

  button.click();
  assert.equal(group.classList.contains('mobile-panel-open'), true);
  assert.equal(button.getAttribute('aria-expanded'), 'true');

  button.click();
  assert.equal(group.classList.contains('mobile-panel-open'), false);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
});

test('tapping the globe puts an open group away', () => {
  const { documentRef, created, panels, listeners } = makeDocument();
  initMobilePanelSwitches({ documentRef, matchMedia: desktopQuery });
  const button = created.find((b) => b.dataset.panelGroup === 'right-context-rail');
  const group = panels['right-context-rail'];

  button.click();
  assert.equal(group.classList.contains('mobile-panel-open'), true);

  // A pointerdown outside both the group and its button is the map.
  listeners.get('pointerdown')?.({ target: {} });
  assert.equal(group.classList.contains('mobile-panel-open'), false);
});

test('widening past the phone breakpoint closes every group', () => {
  const { documentRef, created, panels } = makeDocument();
  let onChange = null;
  initMobilePanelSwitches({
    documentRef,
    matchMedia: () => ({
      matches: true,
      addEventListener: (_type, fn) => {
        onChange = fn;
      },
      removeEventListener() {},
    }),
  });
  for (const button of created) button.click();
  assert.equal(panels['left-panel-stack'].classList.contains('mobile-panel-open'), true);

  onChange?.({ matches: false });
  for (const group of MOBILE_PANEL_GROUPS) {
    assert.equal(
      panels[group.id].classList.contains('mobile-panel-open'),
      false,
      group.id,
    );
  }
});
