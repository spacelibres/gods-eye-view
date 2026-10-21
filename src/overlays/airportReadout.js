import { t } from '../i18n/index.js';

/** Accessible DOM treatment for the selected airport; no canvas or frame loop. */
export function createAirportReadout({
  viewer,
  document: doc = globalThis.document,
  Observer = globalThis.MutationObserver,
  onClose = () => {},
} = {}) {
  if (!doc?.createElement || !viewer?.container?.appendChild) return null;
  const make = (tag, className, parent) => {
    const node = doc.createElement(tag);
    node.className = className;
    parent?.appendChild(node);
    return node;
  };
  const root = make('section', 'airport-detail-card', viewer.container);
  root.id = 'airport-detail-card';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-labelledby', 'airport-detail-title');
  root.setAttribute('data-panel-popup', '');
  const header = make('div', 'airport-detail-header', root);
  const symbol = make('img', 'airport-detail-symbol', header);
  symbol.alt = '';
  symbol.setAttribute('aria-hidden', 'true');
  const identity = make('div', 'airport-detail-identity', header);
  const kicker = make('div', 'airport-detail-kicker', identity);
  const title = make('h2', 'airport-detail-title', identity);
  title.id = 'airport-detail-title';
  title.setAttribute('translate', 'no');
  const close = make('button', 'airport-detail-close', header);
  close.type = 'button';
  close.textContent = '×'; // i18n-ignore: close glyph
  close.setAttribute('translate', 'no');
  const codes = make('div', 'airport-detail-codes', root);
  const fields = make('dl', 'airport-detail-fields', root);
  const footer = make('div', 'airport-detail-footer', root);
  const sourceLabel = make('span', '', footer);
  const sourceLink = make('a', 'airport-detail-source', footer);
  sourceLink.setAttribute('translate', 'no');
  sourceLink.target = '_blank';
  sourceLink.rel = 'noopener noreferrer';
  let active = null;
  let previousFocus = null;
  let destroyed = false;

  const hide = () => {
    active = null;
    root.hidden = true;
    if (root.contains(doc.activeElement))
      previousFocus?.focus?.({ preventScroll: true });
  };
  const dismiss = (event) => {
    event?.stopPropagation?.();
    if (!active) return;
    const entity = active;
    hide();
    onClose(entity);
  };
  const onKey = (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !active) return;
    if (
      event.target?.closest?.(
        'input,textarea,select,[contenteditable="true"]',
      ) &&
      !root.contains(event.target)
    )
      return;
    if (
      [
        ...(doc.querySelectorAll?.('dialog[open], [aria-modal="true"]') || []),
      ].some((node) => node !== root && node.getClientRects?.().length)
    )
      return;
    event.preventDefault();
    dismiss(event);
  };
  const stopPointer = (event) => event.stopPropagation();
  close.addEventListener('click', dismiss);
  root.addEventListener('pointerdown', stopPointer);
  doc.addEventListener('keydown', onKey);

  const refresh = () => {
    if (destroyed || !active) return;
    const model = active.getAirportReadout();
    kicker.textContent = t('Airport');
    title.textContent = model.title;
    close.setAttribute('aria-label', t('Close'));
    close.title = t('Close');
    symbol.hidden = !model.symbol;
    if (model.symbol) symbol.src = model.symbol;
    codes.replaceChildren();
    for (const code of model.codes || []) {
      const badge = make('span', 'airport-detail-code', codes);
      const label = make('span', '', badge);
      label.textContent = code.label;
      label.setAttribute('translate', 'no');
      const value = make('strong', '', badge);
      value.textContent = code.value;
      value.setAttribute('translate', 'no');
    }
    codes.hidden = !codes.children.length;
    fields.replaceChildren();
    for (const [label, value] of model.rows || []) {
      const field = make('div', 'airport-detail-field', fields);
      make('dt', '', field).textContent = t(label);
      const detail = make('dd', '', field);
      detail.textContent = value;
      detail.setAttribute('translate', 'no');
    }
    sourceLabel.textContent = t('Source');
    sourceLink.textContent = model.source || 'OurAirports'; // i18n-ignore: provider name
    let url = null;
    try {
      const parsed = new URL(model.sourceUrl);
      if (['https:', 'http:'].includes(parsed.protocol)) url = parsed.href;
    } catch {
      /* Missing source URLs do not create an unsafe link. */
    }
    sourceLink.href = url || 'https://ourairports.com/';
  };
  const observer =
    typeof Observer === 'function' ? new Observer(refresh) : null;
  if (doc.documentElement)
    observer?.observe(doc.documentElement, {
      attributes: true,
      attributeFilter: ['lang'],
    });
  return {
    show(entity) {
      if (destroyed || typeof entity?.getAirportReadout !== 'function')
        return false;
      const opening = root.hidden;
      if (opening) previousFocus = doc.activeElement;
      active = entity;
      refresh();
      root.hidden = false;
      if (opening) close.focus?.({ preventScroll: true });
      return true;
    },
    refresh,
    hide,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      hide();
      observer?.disconnect();
      close.removeEventListener('click', dismiss);
      root.removeEventListener('pointerdown', stopPointer);
      doc.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}
