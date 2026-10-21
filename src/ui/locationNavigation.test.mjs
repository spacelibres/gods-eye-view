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
test('pending airport choices refresh by stable ID and click returns localized label without replacing buttons', async () => {
  const { row, input } = fixture();
  let refresh,
    locale = 'en';
  const pending = chooseAirportDestination(
    row,
    input,
    [
      {
        airportId: '1',
        name: 'Old Airport',
        label: 'Old Airport',
        lat: 1,
        lng: 2,
      },
    ],
    {
      getLocale: () => locale,
      registerLocaleRefresh: (callback) => {
        refresh = callback;
        return () => {
          refresh = null;
        };
      },
      source: {
        getAirport: async (id) => ({
          airport: {
            id,
            name: '本地机场',
            municipality: '城市',
            country: '国家',
            lat: 1,
            lon: 2,
          },
        }),
      },
    },
  );
  const button = row.children[0];
  locale = 'zh-CN';
  await refresh();
  assert.equal(row.children[0], button);
  assert.equal(button.textContent, '本地机场, 城市, 国家');
  button.listeners.click();
  assert.equal((await pending).label, '本地机场, 城市, 国家');
  assert.equal(refresh, null);
});
test('airport choices ignore previous locale responses and never reopen after dismissal', async () => {
  const { row, input } = fixture();
  let refresh,
    locale = 'en';
  const replies = [];
  const controller = new AbortController();
  const pending = chooseAirportDestination(
    row,
    input,
    [{ airportId: '1', label: 'Original' }],
    {
      signal: controller.signal,
      getLocale: () => locale,
      registerLocaleRefresh: (callback) => {
        refresh = callback;
      },
      source: {
        getAirport: () => new Promise((resolve) => replies.push(resolve)),
      },
    },
  );
  const older = refresh();
  locale = 'zh-CN';
  const newer = refresh();
  replies[1]({ airport: { id: '1', name: '机场', lat: 1, lon: 2 } });
  await newer;
  replies[0]({ airport: { id: '1', name: 'Old airport', lat: 1, lon: 2 } });
  await older;
  assert.equal(row.children[0].textContent, '机场');
  const last = refresh();
  controller.abort();
  assert.equal(await pending, null);
  replies[2]({ airport: { id: '1', name: 'Late', lat: 1, lon: 2 } });
  await last;
  assert.equal(row.children.length, 0);
});
