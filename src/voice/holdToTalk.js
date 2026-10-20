/**
 * Hold-to-talk for a touch screen.
 *
 * A phone has no Space bar, so the keyboard gesture the desktop uses —
 * hold to speak, release to stop — has nothing to bind to. The voice button
 * itself becomes the hold target: pressing it starts listening, lifting the
 * finger stops listening, exactly like a walkie-talkie.
 *
 * The session is not torn down on release. Connecting costs a token and a
 * socket handshake, so a second press resumes the same session with the
 * microphone switched back on; only a long gap or an explicit stop closes it.
 */

/** Presses shorter than this are taps, not speech. */
export const MIN_HOLD_MS = 350;

/**
 * Bind press-and-hold behaviour to an element.
 *
 * Pointer events cover touch, pen and mouse with one code path, and
 * `pointercancel` fires when the browser takes the gesture back (a scroll, a
 * call arriving) — leaving the microphone open would be the worst outcome, so
 * it ends the hold too.
 *
 * @param {object} options
 * @param {HTMLElement} options.element The button to hold.
 * @param {() => boolean} options.isActive Whether a session is running.
 * @param {() => Promise<void>|void} options.onStart Begin listening.
 * @param {() => void} options.onEnd Stop listening.
 * @param {() => void} [options.onTap] A press too short to be speech.
 * @param {() => number} [options.now] Clock, injectable for tests.
 * @returns {() => void} Removes every listener.
 */
export function bindHoldToTalk({
  element,
  isActive,
  onStart,
  onEnd,
  onTap,
  now = () => Date.now(),
}) {
  if (!element) return () => {};
  let holding = false;
  let startedAt = 0;
  let pointerId = null;

  const begin = async (event) => {
    // Ignore a second finger: one press is one microphone.
    if (holding) return;
    holding = true;
    startedAt = now();
    pointerId = event?.pointerId ?? null;
    try {
      element.setPointerCapture?.(pointerId);
    } catch {
      // Capture is an optimisation; losing it only costs a stray pointerup.
    }
    try {
      await onStart();
    } catch {
      // A failed start is reported by the session itself.
      holding = false;
    }
  };

  const finish = (event) => {
    if (!holding) return;
    // A press released by a different pointer than the one that started it is
    // not this hold ending.
    if (
      event?.pointerId != null &&
      pointerId != null &&
      event.pointerId !== pointerId
    )
      return;
    holding = false;
    pointerId = null;
    try {
      element.releasePointerCapture?.(event?.pointerId ?? undefined);
    } catch {
      // Already released.
    }
    const held = now() - startedAt;
    onEnd();
    // A tap holds the microphone for a few milliseconds, which no recogniser
    // will treat as speech; say so instead of leaving the user unsure. The
    // session stays open either way, so a longer press can follow at once.
    if (held < MIN_HOLD_MS) onTap?.();
  };

  element.addEventListener('pointerdown', begin);
  element.addEventListener('pointerup', finish);
  element.addEventListener('pointercancel', finish);
  // A finger that slides off the button still ends the hold.
  element.addEventListener('lostpointercapture', finish);
  // Long-press on a phone otherwise opens the OS context menu mid-sentence.
  const suppressMenu = (event) => {
    if (holding) event.preventDefault();
  };
  element.addEventListener('contextmenu', suppressMenu);

  return () => {
    element.removeEventListener('pointerdown', begin);
    element.removeEventListener('pointerup', finish);
    element.removeEventListener('pointercancel', finish);
    element.removeEventListener('lostpointercapture', finish);
    element.removeEventListener('contextmenu', suppressMenu);
  };
}
