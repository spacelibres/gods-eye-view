const ATTRIBUTES = ['title', 'aria-label', 'placeholder', 'alt'];
const EXCLUDED =
  '[translate="no"], [data-i18n-skip], .locale-picker-native, svg, .material-symbols-outlined, .data-icon, script, style, pre, code, [contenteditable="true"]';

/** Retain nodes/listeners/form values while updating runtime-created UI copy. */
export function createLiveDocument(
  doc,
  { resolve, render, Observer = globalThis.MutationObserver },
) {
  const slots = new WeakMap();
  let destroyed = false;
  function slot(target, attribute = null) {
    const owner = attribute ? target : target.parentElement;
    if (owner?.closest?.(EXCLUDED)) return;
    if (!attribute && owner?.tagName === 'TEXTAREA') return;
    const current = attribute
      ? target.getAttribute(attribute)
      : target.nodeValue;
    if (typeof current !== 'string' || !current.trim()) return;
    let bindings = slots.get(target);
    if (!bindings) {
      bindings = new Map();
      slots.set(target, bindings);
    }
    let state = bindings.get(attribute);
    if (!state || state.last !== current) {
      const binding = resolve(current, target, attribute);
      if (!binding) {
        bindings.delete(attribute);
        return;
      }
      state = {
        binding,
        prefix: current.match(/^\s*/)[0],
        suffix: current.match(/\s*$/)[0],
      };
      bindings.set(attribute, state);
    }
    const next = state.prefix + render(state.binding) + state.suffix;
    if (next !== current) {
      if (attribute) target.setAttribute(attribute, next);
      else target.nodeValue = next;
    }
    state.last = next;
  }
  function element(el) {
    if (el.closest?.(EXCLUDED)) return;
    for (const attribute of ATTRIBUTES)
      if (el.hasAttribute?.(attribute)) slot(el, attribute);
    for (const child of el.childNodes || [])
      if (child.nodeType === 3) slot(child);
  }
  function refresh(root = doc) {
    if (destroyed || !root) return;
    if (root.nodeType === 3) {
      slot(root);
      return;
    }
    if (root.nodeType === 1) element(root);
    for (const el of root.querySelectorAll?.('*') || []) element(el);
  }
  refresh();
  const observer =
    typeof Observer === 'function'
      ? new Observer((records) => {
          if (destroyed) return;
          const changed = new Set();
          for (const record of records) {
            if (record.type === 'childList')
              for (const node of record.addedNodes) changed.add(node);
            else changed.add(record.target);
          }
          for (const root of changed) refresh(root);
        })
      : null;
  if (doc.documentElement)
    observer?.observe(doc.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRIBUTES,
    });
  return {
    refresh,
    capture: refresh,
    destroy() {
      destroyed = true;
      observer?.disconnect();
    },
  };
}
