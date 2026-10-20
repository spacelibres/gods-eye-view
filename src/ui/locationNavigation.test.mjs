import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseAirportDestination } from './locationNavigation.js';
function element() {
  return {
    children: [],
    listeners: {},
    classList: { add() {}, remove() {} },
    setAttribute() {},
    removeAttribute() {},
    replaceChildren() {
      this.children = [];
    },
    appendChild(child) {
      this.children.push(child);
    },
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    removeEventListener(type) {
      delete this.listeners[type];
    },
    focus() {
      this.focused = true;
    },
  };
}
function fixture() {
  const row = element();
  row.ownerDocument = { createElement: element };
  const input = element();
  return { row, input };
}
test('airport choices safely show labels and require an explicit button choice', async () => {
  const { row, input } = fixture();
  const choices = [{ label: '<First>' }, { label: 'Second' }];
  const pending = chooseAirportDestination(row, input, choices);
  assert.equal(row.children[0].textContent, '<First>');
  assert.equal(row.children[0].focused, true);
  row.children[1].listeners.click();
  assert.equal(await pending, choices[1]);
  assert.equal(row.children.length, 0);
});
test('airport choices clean up on cancellation and Escape', async () => {
  for (const mode of ['abort', 'escape']) {
    const { row, input } = fixture();
    const controller = new AbortController();
    const pending = chooseAirportDestination(
      row,
      input,
      [{ label: 'Airport' }],
      { signal: controller.signal },
    );
    if (mode === 'abort') controller.abort();
    else
      row.listeners.keydown({
        key: 'Escape',
        preventDefault() {},
        stopPropagation() {},
      });
    assert.equal(await pending, null);
    assert.equal(row.children.length, 0);
  }
});
