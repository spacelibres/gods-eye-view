import test from 'node:test';
import assert from 'node:assert/strict';
import { createAirportReadout } from './airportReadout.js';
class Element {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this.hidden = false;
    this.style = {};
  }
  setAttribute(k, v) {
    this.attrs.set(k, v);
  }
  getAttribute(k) {
    return this.attrs.get(k) ?? null;
  }
  append(...nodes) {
    for (const n of nodes) {
      n.parentElement = this;
      this.children.push(n);
    }
  }
  appendChild(n) {
    this.append(n);
    return n;
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }
  addEventListener(k, fn) {
    this.listeners.set(k, fn);
  }
  removeEventListener(k) {
    this.listeners.delete(k);
  }
  fire(k, event = {}) {
    this.listeners.get(k)?.({
      stopPropagation() {},
      preventDefault() {},
      ...event,
    });
  }
  remove() {
    if (this.parentElement)
      this.parentElement.children = this.parentElement.children.filter(
        (n) => n !== this,
      );
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
  contains(node) {
    return node === this || this.children.some((c) => c.contains(node));
  }
}
function fixture() {
  const doc = {
    listeners: new Map(),
    createElement(tag) {
      return new Element(tag, this);
    },
    addEventListener(k, fn) {
      this.listeners.set(k, fn);
    },
    removeEventListener(k) {
      this.listeners.delete(k);
    },
    activeElement: null,
  };
  doc.body = new Element('body', doc);
  doc.documentElement = new Element('html', doc);
  const all = (node) => [node, ...node.children.flatMap(all)];
  let closed = 0;
  const card = createAirportReadout({
    viewer: { container: doc.body },
    document: doc,
    Observer: null,
    onClose: () => closed++,
  });
  const entity = {
    getAirportReadout: () => ({
      title: '<Airport>',
      codes: [{ label: 'ICAO', value: 'ZBAA' }],
      rows: [
        ['Type', 'Large airport'],
        ['Country', 'China'],
      ],
      source: 'OurAirports',
      sourceUrl: 'https://ourairports.com/',
    }),
  };
  return { doc, card, entity, all: () => all(doc.body), closed: () => closed };
}
test('airport card has a real close button, compact fields and plain-text identifiers', () => {
  const f = fixture();
  assert.equal(f.card.show(f.entity), true);
  const root = f.all().find((n) => n.id === 'airport-detail-card');
  assert.equal(root.hidden, false);
  assert.ok(f.all().some((n) => n.textContent === '<Airport>'));
  assert.ok(
    f
      .all()
      .some(
        (n) => n.textContent === 'ZBAA' && n.getAttribute('translate') === 'no',
      ),
  );
  const button = f.all().find((n) => n.tagName === 'BUTTON');
  button.fire('click');
  assert.equal(f.closed(), 1);
  assert.equal(root.hidden, true);
  f.card.destroy();
  assert.equal(f.doc.body.children.length, 0);
});
test('Escape dismisses only an open card and listeners are released', () => {
  const f = fixture();
  f.card.show(f.entity);
  const escape = () =>
    f.doc.listeners.get('keydown')?.({
      key: 'Escape',
      preventDefault() {},
      stopPropagation() {},
    });
  escape();
  escape();
  assert.equal(f.closed(), 1);
  f.card.show(f.entity);
  f.card.hide();
  escape();
  assert.equal(f.closed(), 1);
  f.card.destroy();
  assert.equal(f.doc.listeners.size, 0);
});
test('refresh updates the active card without reopening a dismissed one', () => {
  const f = fixture();
  f.card.show(f.entity);
  f.entity.getAirportReadout = () => ({
    title: 'Updated',
    codes: [],
    rows: [],
    source: 'OurAirports',
    sourceUrl: 'javascript:alert(1)',
  });
  f.card.refresh();
  assert.ok(f.all().some((n) => n.textContent === 'Updated'));
  assert.ok(
    f
      .all()
      .filter((n) => n.tagName === 'A')
      .every((n) => !n.href?.startsWith('javascript:')),
  );
  f.card.hide();
  f.card.refresh();
  assert.equal(
    f.all().find((n) => n.id === 'airport-detail-card').hidden,
    true,
  );
  f.card.destroy();
});
