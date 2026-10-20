/**
 * A phone-sized switch for the two panel groups.
 *
 * On a phone the left stack and the right rail cover most of the globe even
 * when every panel inside them is collapsed: the rows still stack up. This
 * hides both groups behind one button each, sized for a thumb, and shows them
 * as an overlay when opened. On a wider viewport nothing here applies.
 *
 * It is deliberately separate from `panelDisclosure`: those buttons collapse a
 * panel inside its group, this one puts the whole group away. Both can be true
 * at once, and neither has to know about the other.
 */

/** Above this width the desktop rails are used as-is. */
export const MOBILE_MAX_WIDTH_PX = 720;

/** The groups the switch hides, with the gesture target that opens them. */
export const MOBILE_PANEL_GROUPS = Object.freeze([
  {
    id: 'left-panel-stack',
    label: 'Data',
    // A stack of layers, NOT `layers_clear`: that glyph is the "clear selected
    // layers" action in the top row, and reusing it made two buttons look alike.
    icon: 'layers',
  },
  {
    id: 'right-context-rail',
    label: 'Display',
    // Sliders, matching what the rail holds rather than which side it is on.
    icon: 'tune',
  },
]);

/**
 * Mount the switches. They are only visible (and only bound) on a phone.
 *
 * @param {object} options
 * @param {Document} [options.documentRef]
 * @param {Function} [options.matchMedia] Injectable for tests.
 * @returns {{destroy: () => void}}
 */
export function initMobilePanelSwitches({
  documentRef = globalThis.document,
  matchMedia = (...args) => globalThis.matchMedia?.(...args),
} = {}) {
  const cleanups = [];
  const host = documentRef?.body;
  if (!host) return { destroy() {} };

  const groups = MOBILE_PANEL_GROUPS.map((group) => {
    const panel = documentRef.getElementById(group.id);
    if (!panel) return null;

    const button = documentRef.createElement('button');
    button.type = 'button';
    button.className = 'mobile-panel-switch';
    button.dataset.panelGroup = group.id;
    button.setAttribute('aria-controls', group.id);
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', group.label);
    button.title = group.label;
    button.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${group.icon}</span>`;
    host.appendChild(button);

    const setOpen = (open) => {
      panel.classList.toggle('mobile-panel-open', open);
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    const onClick = (event) => {
      event.preventDefault();
      setOpen(!panel.classList.contains('mobile-panel-open'));
    };
    button.addEventListener('click', onClick);
    cleanups.push(() => button.removeEventListener('click', onClick));

    // Tapping the globe puts the group away: the map is what the visitor came
    // for, and a full-height rail leaves no other way back except the button.
    const onDocumentPointer = (event) => {
      if (!panel.classList.contains('mobile-panel-open')) return;
      if (panel.contains(event.target) || button.contains(event.target)) return;
      setOpen(false);
    };
    documentRef.addEventListener('pointerdown', onDocumentPointer);
    cleanups.push(() =>
      documentRef.removeEventListener('pointerdown', onDocumentPointer),
    );

    cleanups.push(() => button.remove());
    return { group, panel, button, setOpen };
  }).filter(Boolean);

  // A switch left open across a resize would keep a rail over the desktop
  // layout, so close everything when the viewport widens.
  const query = matchMedia(`(max-width: ${MOBILE_MAX_WIDTH_PX}px)`);
  const onChange = (event) => {
    if (event.matches) return;
    for (const entry of groups) entry.setOpen(false);
  };
  if (query?.addEventListener) {
    query.addEventListener('change', onChange);
    cleanups.push(() => query.removeEventListener('change', onChange));
  }

  return {
    destroy() {
      for (const cleanup of cleanups.splice(0)) cleanup();
    },
  };
}
