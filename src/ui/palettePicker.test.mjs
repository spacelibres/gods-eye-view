import test from 'node:test';
import assert from 'node:assert/strict';

import { mountPalettePicker } from './palettePicker.js';

/**
 * A tiny DOM, just enough for `mountPalettePicker`: elements come out of
 * `innerHTML` as buttons and labels, which is all the picker's markup uses.
 *
 * The picker builds its swatches from an HTML string, so the stub parses
 * `<button ...>` and `<input ...>` tags and ignores the rest of the markup.
 * That keeps the test on the behaviour — open, choose, close — rather than on
 * a full HTML implementation.
 */
function parseMarkup(node, html) {
  const tags = html.match(/<(button|input|label|span)\b([^>]*)>/g) ?? [];
  for (const tag of tags) {
    const name = /^<(\w+)/.exec(tag)[1];
    const el = makeElement(node.ownerDocument, name);
    const attrs = tag.match(/([\w-]+)="([^"]*)"/g) ?? [];
    for (const attr of attrs) {
      const [, key, value] = /([\w-]+)="([^"]*)"/.exec(attr);
      if (key === 'class') el.className = value;
      else if (key === 'type') el.type = value;
      else if (key === 'value') el.value = value;
      else if (key === 'role') el.role = value;
      else if (key.startsWith('data-')) {
        const camel = key
          .slice(5)
          .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        el.dataset[camel] = value;
      } else if (key === 'style') {
        const swatch = /--swatch:\s*([^;]+)/.exec(value);
        if (swatch) el.style.setProperty('--swatch', swatch[1].trim());
      } else el.setAttribute(key, value);
    }
    node.appendChild(el);
  }
}

function makeElement(documentRef, tag) {
  const el = {
    tagName: tag.toUpperCase(),
    ownerDocument: documentRef,
    children: [],
    dataset: {},
    attributes: new Map(),
    listeners: new Map(),
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(handler);
    },
    /** Fire a handler the way the browser would, for the test that needs it. */
    dispatch(type, event = {}) {
      for (const handler of this.listeners.get(type) ?? []) handler(event);
    },
    classList: {
      _set: new Set(),
      add(...names) {
        for (const n of names) this._set.add(n);
      },
      remove(...names) {
        for (const n of names) this._set.delete(n);
      },
      contains(name) {
        return this._set.has(name);
      },
      toggle(name, force) {
        const on = force === undefined ? !this._set.has(name) : force;
        if (on) this._set.add(name);
        else this._set.delete(name);
        return on;
      },
    },
    style: {
      _vars: new Map(),
      setProperty(name, value) {
        this._vars.set(name, value);
      },
      getPropertyValue(name) {
        return this._vars.get(name) ?? '';
      },
    },
    hidden: false,
    textContent: '',
    get className() {
      return [...this.classList._set].join(' ');
    },
    set className(value) {
      this.classList._set = new Set(String(value).split(/\s+/).filter(Boolean));
    },
    set innerHTML(html) {
      this.children = [];
      parseMarkup(this, html);
    },
    getAttribute(key) {
      return this.attributes.get(key) ?? null;
    },
    setAttribute(key, value) {
      this.attributes.set(key, String(value));
    },
    append(...nodes) {
      for (const node of nodes) {
        node.parent = this;
        this.children.push(node);
      }
    },
    appendChild(node) {
      this.append(node);
      return node;
    },
    focus() {
      documentRef.activeElement = this;
    },
    closest(selector) {
      let node = this;
      while (node) {
        if (matches(node, selector)) return node;
        node = node.parent;
      }
      return null;
    },
    contains(other) {
      if (other === this) return true;
      return this.children.some((child) => child.contains?.(other));
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector) {
      const out = [];
      const walk = (node) => {
        for (const child of node.children) {
          if (matches(child, selector)) out.push(child);
          walk(child);
        }
      };
      walk(this);
      return out;
    },
  };
  el.parent = null;
  return el;
}

function matches(el, selector) {
  if (selector === 'input[type="color"]')
    return el.tagName === 'INPUT' && el.type === 'color';
  if (selector.startsWith('.')) return el.classList.contains(selector.slice(1));
  return false;
}

function fixture(primary = '#007BFF') {
  const documentRef = {
    activeElement: null,
    listeners: new Map(),
    createElement(tag) {
      return makeElement(documentRef, tag);
    },
    addEventListener(type, handler) {
      (this.listeners.get(type) ?? this.listeners.set(type, []).get(type)).push(
        handler,
      );
    },
    dispatch(type, event) {
      for (const handler of this.listeners.get(type) ?? []) handler(event);
    },
  };
  const root = documentRef.createElement('div');
  const chosen = [];
  const mount = mountPalettePicker({
    root,
    primary,
    onSelect: (value) => chosen.push(value),
  });
  return { documentRef, root, chosen, mount };
}

test('a phone gets one button, and the swatches stay behind it', () => {
  const { root } = fixture();
  const button = root.children.find((c) => c.classList.contains('palette-toggle'));
  const panel = root.children.find((c) => c.classList.contains('palette-panel'));
  assert.ok(button, 'the toggle is mounted');
  assert.ok(panel, 'the swatch row lives in a panel');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(panel.hidden, true, 'the panel starts closed, so it does not cover the map');
  // Every preset plus the custom colour is inside the panel, none at the root.
  const swatches = panel.querySelectorAll('.palette-swatch');
  assert.equal(swatches.length, 6);
  assert.equal(root.querySelectorAll('.palette-swatch').length, 6);
});

test('tapping the button opens every scheme and tapping again puts them away', () => {
  const { root } = fixture();
  const button = root.children.find((c) => c.classList.contains('palette-toggle'));
  const panel = root.children.find((c) => c.classList.contains('palette-panel'));

  button.dispatch('click');
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(panel.hidden, false);
  assert.equal(root.classList.contains('is-open'), true);

  button.dispatch('click');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(panel.hidden, true);
});

test('the button is one glyph with no state chip, and choosing still applies', () => {
  const { root, chosen } = fixture('#007BFF');
  const button = root.children.find((c) => c.classList.contains('palette-toggle'));

  // A single icon: no second dot beside it, which read as its own control.
  const glyphs = button.children;
  assert.equal(glyphs.length, 1, 'the button holds one element');
  assert.ok(glyphs[0].classList.contains('material-symbols-outlined'));
  assert.equal(
    button.querySelectorAll('.palette-toggle-chip').length,
    0,
    'no colour dot on the button',
  );

  const swatch = root.querySelectorAll('.palette-swatch')[2];
  root.dispatch('click', { target: swatch });
  assert.deepEqual(chosen, [swatch.dataset.primary], 'the choice still applies');
});

test('a tap outside the panel and Escape both put it away', () => {
  const { root, documentRef } = fixture();
  const button = root.children.find((c) => c.classList.contains('palette-toggle'));
  const panel = root.children.find((c) => c.classList.contains('palette-panel'));

  button.dispatch('click');
  assert.equal(panel.hidden, false);
  documentRef.dispatch('pointerdown', { target: { outside: true } });
  assert.equal(panel.hidden, true, 'a tap on the globe closes it');

  button.dispatch('click');
  assert.equal(panel.hidden, false);
  documentRef.dispatch('keydown', { key: 'Escape' });
  assert.equal(panel.hidden, true);
  assert.equal(documentRef.activeElement, button, 'focus returns to the button');
});

test('a tap inside the panel leaves it open', () => {
  const { root, documentRef } = fixture();
  const button = root.children.find((c) => c.classList.contains('palette-toggle'));
  const panel = root.children.find((c) => c.classList.contains('palette-panel'));
  const inner = panel.querySelectorAll('.palette-swatch')[0];

  button.dispatch('click');
  documentRef.dispatch('pointerdown', { target: inner });
  assert.equal(panel.hidden, false);
});
