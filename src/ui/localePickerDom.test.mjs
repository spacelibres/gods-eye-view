// The interface language picker with just enough DOM to see the visible
// selection: the checkmark and the row order follow a language applied
// elsewhere (the live switch in the shell).
import test from 'node:test';
import assert from 'node:assert/strict';

import { mountLocalePicker } from './localePicker.js';

const LOCALES = ['en', 'ja', 'ko', 'zh-CN', 'zh-TW'];
const NAMES = {
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
};

function makeElement(documentRef, tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    ownerDocument: documentRef,
    children: [],
    dataset: {},
    attributes: new Map(),
    listeners: new Map(),
    hidden: false,
    textContent: '',
    classList: {
      _set: new Set(),
      add(...names) {
        for (const name of names) this._set.add(name);
      },
      remove(...names) {
        for (const name of names) this._set.delete(name);
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
    get className() {
      return [...this.classList._set].join(' ');
    },
    set className(value) {
      this.classList._set = new Set(String(value).split(/\s+/).filter(Boolean));
    },
    getAttribute(key) {
      return this.attributes.get(key) ?? null;
    },
    setAttribute(key, value) {
      this.attributes.set(key, String(value));
    },
    removeAttribute(key) {
      this.attributes.delete(key);
    },
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      const list = this.listeners.get(type);
      if (list) this.listeners.set(type, list.filter((fn) => fn !== handler));
    },
    append(...nodes) {
      for (const node of nodes) {
        // A real DOM moves a node that already has a parent.
        const previous = node.parent;
        if (previous) previous.children = previous.children.filter((n) => n !== node);
        node.parent = this;
        this.children.push(node);
      }
    },
    replaceChildren(...nodes) {
      this.children = [];
      this.append(...nodes);
    },
    focus() {
      documentRef.activeElement = this;
    },
    scrollIntoView() {},
    contains(other) {
      if (other === this) return true;
      return this.children.some((child) => child.contains?.(other));
    },
  };
  return el;
}

function makeDocument() {
  const documentRef = {
    activeElement: null,
    createElement: (tag) => makeElement(documentRef, tag),
    createElementNS: (_ns, tag) => makeElement(documentRef, tag),
    addEventListener() {},
    removeEventListener() {},
  };
  documentRef.defaultView = {
    addEventListener() {},
    removeEventListener() {},
  };
  return documentRef;
}

function mount(current = 'zh-CN') {
  const documentRef = makeDocument();
  const root = makeElement(documentRef, 'div');
  root.id = 'locale-picker';
  const picker = mountLocalePicker({
    root,
    current,
    locales: LOCALES,
    nativeNames: NAMES,
    onSelect: () => {},
  });
  const popup = root.children.find((node) => node.id === 'lang-popup') ?? null;
  const listbox = root.children
    .flatMap((node) => node.children)
    .find((node) => node.getAttribute?.('role') === 'listbox');
  return { picker, root, popup, listbox };
}

/** The locale of the row that currently carries the check icon. */
function checkedRow(listbox) {
  const row = listbox.children.find((item) =>
    item.children.some(
      (child) => child.getAttribute?.('class') === 'locale-picker-check',
    ),
  );
  return row?.dataset.locale ?? null;
}

const rowCodes = (listbox) =>
  listbox.children.map((item) => item.dataset.locale);

const selectedRows = (listbox) =>
  listbox.children
    .filter((item) => item.getAttribute('aria-selected') === 'true')
    .map((item) => item.dataset.locale);

test('the checkmark starts on the language the picker was built for', () => {
  const { picker, listbox } = mount('zh-CN');
  picker.open();
  assert.equal(checkedRow(listbox), 'zh-CN');
  assert.deepEqual(selectedRows(listbox), ['zh-CN']);
});

test('a live switch moves the checkmark, the ARIA flag and the row order', () => {
  const { picker, listbox } = mount('zh-CN');
  picker.open();
  picker.setCurrent('ja');

  assert.equal(checkedRow(listbox), 'ja');
  assert.deepEqual(selectedRows(listbox), ['ja']);
  assert.equal(rowCodes(listbox)[0], 'ja', 'the active language comes first');
  assert.equal(
    rowCodes(listbox).length,
    LOCALES.length,
    'no row is duplicated or lost when the list is reordered',
  );
});

test('switching back restores the mark without leaving a second one', () => {
  const { picker, listbox } = mount('zh-CN');
  picker.open();
  picker.setCurrent('ja');
  picker.setCurrent('zh-CN');

  assert.equal(checkedRow(listbox), 'zh-CN');
  const marks = listbox.children.filter((item) =>
    item.children.some(
      (child) => child.getAttribute?.('class') === 'locale-picker-check',
    ),
  );
  assert.equal(marks.length, 1, 'exactly one row is marked');
  assert.equal(rowCodes(listbox)[0], 'zh-CN');
});
