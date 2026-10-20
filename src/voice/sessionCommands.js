import { createVoiceControl, voiceStatusLabel } from './control.js';
import { createVoiceSession } from './session.js';
import { VoiceCardControls } from './voiceCard.js';
import { PointerReticle } from './pointerReticle.js';
import { msg, registerUnsavedWork, t } from '../i18n/index.js';
import {
  VOICE_PROVIDERS,
  pickVoiceProvider,
  readStoredVoiceProvider,
  storeVoiceProvider,
} from './voiceProviders.js';
import { probeVoiceProvidersCached } from './voiceProviderProbe.js';
import { bindHoldToTalk } from './holdToTalk.js';

/**
 * Fill the provider picker and keep the choice.
 *
 * A change takes effect on the next session: the current one owns a live
 * socket whose provider cannot be swapped underneath it, so switching mid-call
 * would leave the audio graph talking to a service that is no longer selected.
 *
 * The server is asked once which providers it holds a credential for. A
 * deployment that set only the other vendor's key then opens the picker on a
 * service that can connect, instead of failing the first call with
 * "OPENAI_API_KEY is not set" for a choice nobody made.
 *
 * @param {HTMLSelectElement|null} select
 * @returns {() => void} Removes the listener.
 */
function bindProviderPicker(select) {
  if (!select) return () => {};
  const current = readStoredVoiceProvider();
  select.textContent = '';
  for (const provider of VOICE_PROVIDERS) {
    const option = select.ownerDocument.createElement('option');
    option.value = provider.id;
    option.textContent = provider.label;
    select.append(option);
  }
  select.value = current.id;
  // One provider is not a choice; keep the row out of the layout until there
  // is something to pick between.
  select.hidden = VOICE_PROVIDERS.length < 2;
  const onChange = () => {
    storeVoiceProvider(select.value);
  };
  select.addEventListener('change', onChange);

  // Correct the selection once the server has answered. The probe is bounded
  // by the browser's own timeout path, so a server that never answers leaves
  // the stored choice in place rather than blocking the control.
  let cancelled = false;
  void probeVoiceProvidersCached()
    .then((configured) => {
      if (cancelled) return;
      const usable = pickVoiceProvider({ configured, storedId: select.value });
      if (!usable) return;
      select.value = usable.id;
      // Only persist when the stored value was actually unusable: an explicit
      // choice must survive a probe, or the picker would fight the user.
      if (!configured[readStoredVoiceProvider().id])
        storeVoiceProvider(usable.id);
    })
    .catch(() => {
      /* A failed probe leaves the stored choice alone. */
    });

  return () => {
    cancelled = true;
    select.removeEventListener('change', onChange);
  };
}

function createDefaultReticle(pointer) {
  const element = pointer?.element;
  const doc = element?.ownerDocument;
  if (!doc) return null;
  return new PointerReticle({
    doc,
    rectOf: () => element.getBoundingClientRect?.() || null,
  });
}

/** Bind common controls to a supplied voice-session adapter. */
export function createVoiceCommands({
  runner,
  dataManager,
  annotations = null,
  createSession,
  createController,
  backend,
  signal,
  debugSink,
  createControl = createVoiceControl,
  createCard = (options) => new VoiceCardControls(options),
  pointer = null,
  referents = null,
  createReticle = createDefaultReticle,
}) {
  window.__gevVoiceCommands?.stop?.({ removeUi: true });
  const ui = createControl({ reset: true });
  const unbindProviderPicker = bindProviderPicker(ui.providerSelect);
  const session = createVoiceSession({
    runner,
    signal,
    createAdapter: (hooks) =>
      createSession({
        ...hooks,
        runner,
        ui,
        dataManager,
        backend,
        debugSink,
        createController,
        pointer,
        radioLayer: dataManager?.layers?.get('radio')?.module || null,
      }),
  });
  const adapter = session.adapter;
  const capabilities = adapter.capabilities || {};
  if (ui.tierButton) ui.tierButton.hidden = !capabilities.costControls;
  if (ui.costValue) ui.costValue.hidden = !capabilities.costControls;
  if (!capabilities.pushToTalk) {
    ui.button.setAttribute('aria-label', t('Toggle voice control'));
    if (ui.helpDetail)
      ui.helpDetail.textContent = t('Activate to toggle voice');
  }
  // Retain the existing controller's inspection surface for browser tools.
  const controls = adapter.controller || session;
  controls.session = session;
  const updateStatus = session.subscribe((event) => {
    if (event.type !== 'state') return;
    ui.root.dataset.status = event.state;
    // States are machine values; only the label is translated.
    ui.status.textContent = voiceStatusLabel(event.state);
    // The portable session reports 'Voice off' in English: show the idle
    // label instead. Other details are provider messages, shown as they come.
    const idle = event.state === 'idle';
    const detail = event.detail === 'Voice off' ? '' : event.detail;
    ui.detail.textContent =
      detail || (idle ? t('Voice off') : t('Voice active'));
    ui.button.setAttribute('aria-pressed', String(session.isActive()));
    if (ui.errorDetail)
      ui.errorDetail.textContent =
        event.state === 'error'
          ? event.detail || t('Voice could not be started.')
          : '';
    if (event.state === 'error') ui.root.classList?.remove('error-dismissed');
  });
  // Captions, plan and result card nested in the control; it only reads
  // provider-neutral session events.
  const card = ui.card ? createCard({ root: ui.root }) : null;
  const updateCard = card
    ? session.subscribe((event) => card.handle(event))
    : null;
  controls.voiceCard = card;
  // Point-and-ask: the reticle follows turn events; pointer and referents are
  // session-scoped, so a session that ends forgets both.
  const reticle = pointer ? createReticle(pointer) : null;
  const updatePointer = session.subscribe((event) => {
    reticle?.handle(event);
    if (event.type === 'state' && ['idle', 'error'].includes(event.state)) {
      pointer?.clear();
      referents?.clear();
      // Conversation memory ("those", "the last answer") ends with the
      // session.
      runner.resetConversation?.();
    }
  });
  controls.pointer = pointer;
  controls.referents = referents;
  const annotationUnsubscribe = annotations?.onOutlineEvent?.((event) => {
    card?.outline(event);
    session.sendMapEvent({ type: 'map_annotation_outline', ...event });
  });
  // A reload (the language switch) ends the conversation: ask first.
  const unregisterUnsavedWork = registerUnsavedWork(() =>
    session.isActive() ? msg('the active voice session') : null,
  );
  const buttonHandler = (event) => {
    // Pointer activation already belongs to the hold; preserve keyboard clicks.
    if (touchHold && event.detail > 0) return;
    if (adapter.ignoreButtonClick?.()) return;
    if (session.isActive()) session.stop();
    else void session.start({ pushToTalk: false });
  };

  // A phone has no Space bar, so holding the button is the gesture: press to
  // speak, lift to stop. On a pointer device with a keyboard the click handler
  // above stays the only binding, since a press is already a discrete action
  // there and a hold would fight the Space-hold path.
  const touchOnly = globalThis.matchMedia?.(
    '(hover: none) and (pointer: coarse)',
  );
  let unbindHold = () => {};
  const touchHold =
    touchOnly?.matches && typeof adapter.setMicrophoneEnabled === 'function';
  if (touchHold) {
    unbindHold = bindHoldToTalk({
      element: ui.button,
      isActive: () => session.isActive(),
      onStart: async () => {
        if (adapter.ignoreButtonClick?.()) return;
        if (!session.isActive()) {
          await session.start({ pushToTalk: false });
          return;
        }
        // Already connected: just reopen the microphone.
        await session.setMicrophoneEnabled(true);
      },
      onEnd: () => {
        if (!session.isActive()) return;
        // Stop listening, keep the session: reconnecting costs a token and a
        // handshake, which a second press should not pay again.
        session.setMicrophoneEnabled(false);
      },
      onTap: () => {
        // Too short to be speech. Say what the gesture is rather than leaving
        // the user guessing why nothing happened.
        if (ui.detail) ui.detail.textContent = t('Hold the button to speak');
      },
    });
  }
  ui.button.addEventListener('click', buttonHandler);
  session.signal.addEventListener(
    'abort',
    () => {
      ui.button.removeEventListener('click', buttonHandler);
      unregisterUnsavedWork();
      annotationUnsubscribe?.();
      updateStatus();
      updateCard?.();
      updatePointer();
      reticle?.destroy();
      card?.destroy();
      unbindProviderPicker();
      unbindHold();
      runner.dispose?.();
      ui.root.remove();
    },
    { once: true },
  );
  if (session.disposed) {
    ui.button.removeEventListener('click', buttonHandler);
    unregisterUnsavedWork();
    annotationUnsubscribe?.();
    updateStatus();
    updateCard?.();
    updatePointer();
    reticle?.destroy();
    card?.destroy();
    unbindProviderPicker();
    unbindHold();
    runner.dispose?.();
    ui.root.remove();
  } else adapter.bindControls?.();
  window.__gevVoiceCommands = controls;
  return controls;
}
