// Remember only emitted interface messages; preserve their source descriptors.
const fixed = new Map();
const dynamic = new Map();
const ambiguous = new Set();
const key = (text) => String(text).replace(/\s+/g, ' ').trim();
function equalValues(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  for (const name in a)
    if (!Object.hasOwn(b, name) || a[name] !== b[name]) return false;
  for (const name in b) if (!Object.hasOwn(a, name)) return false;
  return true;
}
export function rememberRenderedMessage(
  text,
  source,
  values,
  count,
  one,
  other,
) {
  // Most hot-path messages are plain labels: do not allocate a descriptor,
  // clone values or serialize anything when the same output is already known.
  const normalized = key(text);
  if (!normalized) return text;
  const plural = other !== undefined;
  const cache = values || plural ? dynamic : fixed;
  const previous = dynamic.get(normalized) || fixed.get(normalized);
  if (
    previous &&
    previous.source === source &&
    Boolean(previous.plural) === plural &&
    previous.count === count &&
    previous.one === one &&
    previous.other === other &&
    equalValues(previous.values, values)
  )
    return text;
  if (cache === dynamic && cache.size >= 4096 && !cache.has(normalized)) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
    ambiguous.delete(oldest);
  }
  if (previous) ambiguous.add(normalized);
  cache.set(normalized, {
    source,
    values: values ? { ...values } : undefined,
    ...(plural ? { plural: true, count, one, other } : {}),
  });
  return text;
}
export function resolveRenderedMessage(text) {
  const normalized = key(text);
  if (ambiguous.has(normalized)) return null;
  return dynamic.get(normalized) || fixed.get(normalized) || null;
}
