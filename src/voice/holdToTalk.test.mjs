import test from 'node:test';
import assert from 'node:assert/strict';

import { MIN_HOLD_MS, bindHoldToTalk } from './holdToTalk.js';

/** An element stand-in that records listeners. */
function fakeElement() {
  const listeners = new Map();
  return {
    setPointerCapture() {},
    releasePointerCapture() {},
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      const list = listeners.get(type) ?? [];
      const at = list.indexOf(handler);
      if (at >= 0) list.splice(at, 1);
    },
    fire(type, event = {}) {
      for (const handler of [...(listeners.get(type) ?? [])]) handler(event);
    },
    count() {
      return [...listeners.values()].reduce(
        (sum, list) => sum + list.length,
        0,
      );
    },
  };
}

function harness() {
  const element = fakeElement();
  const events = [];
  let clock = 1_000;
  const unbind = bindHoldToTalk({
    element,
    // The module no longer branches on this, but callers still pass it so the
    // contract stays explicit.
    isActive: () => true,
    onStart: () => events.push('start'),
    onEnd: () => events.push('end'),
    onTap: () => events.push('tap'),
    now: () => clock,
  });
  return {
    element,
    events,
    unbind,
    /** Move the clock as if the finger had been down for `ms`. */
    holdFor: (ms) => {
      clock += ms;
    },
  };
}

test('pressing starts listening and lifting stops it', () => {
  const h = harness();
  h.element.fire('pointerdown', { pointerId: 1 });
  h.holdFor(2_000);
  h.element.fire('pointerup', { pointerId: 1 });
  assert.deepEqual(h.events, ['start', 'end']);
});

test('a cancelled gesture still stops the microphone', () => {
  // The browser takes the pointer back on a scroll or an incoming call.
  // Leaving the microphone open would be the worst outcome.
  const h = harness();
  h.element.fire('pointerdown', { pointerId: 2 });
  h.holdFor(1_500);
  h.element.fire('pointercancel', { pointerId: 2 });
  assert.deepEqual(h.events, ['start', 'end']);
});

test('a finger that slides off the button ends the hold', () => {
  const h = harness();
  h.element.fire('pointerdown', { pointerId: 3 });
  h.holdFor(1_200);
  h.element.fire('lostpointercapture', { pointerId: 3 });
  assert.deepEqual(h.events, ['start', 'end']);
});

test('a second finger does not open a second microphone', () => {
  const h = harness();
  h.element.fire('pointerdown', { pointerId: 4 });
  h.element.fire('pointerdown', { pointerId: 5 });
  assert.deepEqual(h.events, ['start'], 'still one start');
});

test('a release from another pointer does not end this hold', () => {
  const h = harness();
  h.element.fire('pointerdown', { pointerId: 6 });
  h.element.fire('pointerup', { pointerId: 7 });
  assert.deepEqual(h.events, ['start'], 'the hold continues');
});

test('a press too short to be speech says so', () => {
  const h = harness();
  h.element.fire('pointerdown', { pointerId: 8 });
  // Under the threshold: no recogniser would treat this as speech.
  h.holdFor(MIN_HOLD_MS - 100);
  h.element.fire('pointerup', { pointerId: 8 });
  assert.deepEqual(h.events, ['start', 'end', 'tap']);
});

test('a press long enough to be speech says nothing', () => {
  const h = harness();
  h.element.fire('pointerdown', { pointerId: 10 });
  h.holdFor(MIN_HOLD_MS + 500);
  h.element.fire('pointerup', { pointerId: 10 });
  assert.deepEqual(h.events, ['start', 'end'], 'no tap hint');
});

test('the long-press menu is suppressed only while holding', () => {
  const h = harness();
  const prevented = [];
  const event = { preventDefault: () => prevented.push('yes') };
  h.element.fire('contextmenu', event);
  assert.deepEqual(prevented, [], 'no hold, no suppression');
  h.element.fire('pointerdown', { pointerId: 9 });
  h.element.fire('contextmenu', event);
  assert.deepEqual(prevented, ['yes'], 'a held press keeps the menu away');
});

test('unbinding removes every listener', () => {
  const h = harness();
  assert.ok(h.element.count() > 0);
  h.unbind();
  assert.equal(h.element.count(), 0);
});

test('release during startup mutes again when the microphone becomes ready', async () => {
  const element = fakeElement();
  let ready;
  let microphone = false;
  bindHoldToTalk({
    element,
    onStart: async () => {
      await new Promise((resolve) => {
        ready = resolve;
      });
      microphone = true;
    },
    onEnd: () => {
      microphone = false;
    },
  });
  element.fire('pointerdown', { pointerId: 1 });
  element.fire('pointerup', { pointerId: 1 });
  ready();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(microphone, false);
});

test('a second hold shares pending acquisition and keeps its current gesture', async () => {
  const element = fakeElement();
  let ready;
  let starts = 0;
  let microphone = false;
  bindHoldToTalk({
    element,
    onStart: async () => {
      starts++;
      await new Promise((resolve) => {
        ready = resolve;
      });
      microphone = true;
    },
    onEnd: () => {
      microphone = false;
    },
  });
  element.fire('pointerdown', { pointerId: 1 });
  element.fire('pointerup', { pointerId: 1 });
  element.fire('pointerdown', { pointerId: 2 });
  ready();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(starts, 1);
  assert.equal(microphone, true);
  element.fire('pointerup', { pointerId: 2 });
  assert.equal(microphone, false);
});
