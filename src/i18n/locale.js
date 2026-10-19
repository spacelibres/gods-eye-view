// Which locale the page runs in: ?lang= → stored choice → browser languages →
// English. Only shipped locales are ever selected.

import { LOCALE_REGISTRY } from './registry.js';

/** Durable preference key. Matches the repo convention gev:<name>:v1. */
export const LOCALE_STORAGE_KEY = 'gev:locale:v1';

/** Source language and fallback. */
export const DEFAULT_LOCALE = 'en';

/** Shipped locales, in registry order. */
export const LOCALES = Object.freeze(
  LOCALE_REGISTRY.map((locale) => locale.code),
);

/** Each locale named in its own language, for the selector. */
export const LOCALE_NAMES = Object.freeze(
  Object.fromEntries(LOCALE_REGISTRY.map(({ code, name }) => [code, name])),
);

/** Right-to-left locales. */
export const RTL_LOCALES = Object.freeze(
  LOCALE_REGISTRY.filter((locale) => locale.dir === 'rtl').map(
    (locale) => locale.code,
  ),
);

const primary = (candidate) => candidate.trim().toLowerCase().split(/[-_]/)[0];

/*
 * Regions whose Chinese readers expect Traditional characters. A bare 'zh'
 * resolves to Simplified (the larger audience), but these tags keep their
 * script even though no zh-HK/zh-MO catalog is shipped.
 */
const TRADITIONAL_CHINESE_REGIONS = Object.freeze(['tw', 'hk', 'mo']);

/**
 * Map any language tag to a shipped locale: an exact region tag first
 * ('zh-TW'), then the bare code ('zh' → 'zh-CN'), then a variant chosen by
 * the candidate's region ('zh-HK' → 'zh-TW', 'pt-PT' → 'pt-BR').
 * @returns {string|null}
 */
export function normalizeLocale(candidate) {
  if (typeof candidate !== 'string') return null;
  const tag = candidate.trim().replace('_', '-').toLowerCase();
  if (!tag) return null;
  const exact = LOCALES.find((locale) => locale.toLowerCase() === tag);
  if (exact) return exact;
  const language = primary(candidate);
  const region = tag.split('-')[1];
  if (
    language === 'zh' &&
    region &&
    TRADITIONAL_CHINESE_REGIONS.includes(region) &&
    LOCALES.includes('zh-TW')
  ) {
    return 'zh-TW';
  }
  const bare = LOCALES.find((locale) => locale === language);
  if (bare) return bare;
  // No bare code: prefer the variant that shares the candidate's region
  // (pt-PT → no pt-PT, but pt-BR is the only Portuguese), then the first of
  // the language.
  const sameRegion = region
    ? LOCALES.find(
        (locale) =>
          primary(locale) === language &&
          locale.toLowerCase().split('-')[1] === region,
      )
    : undefined;
  if (sameRegion) return sameRegion;
  return LOCALES.find((locale) => primary(locale) === language) ?? null;
}

function queryLocale(location) {
  try {
    return normalizeLocale(new URLSearchParams(location?.search).get('lang'));
  } catch {
    return null;
  }
}

function readStoredLocale(storage) {
  try {
    const store = storage !== undefined ? storage : globalThis.localStorage;
    return normalizeLocale(store?.getItem?.(LOCALE_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Store the choice; false when storage is unavailable. */
export function writeStoredLocale(locale, storage) {
  const normalized = normalizeLocale(locale) || DEFAULT_LOCALE;
  try {
    const store = storage !== undefined ? storage : globalThis.localStorage;
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(LOCALE_STORAGE_KEY, normalized);
    return true;
  } catch {
    return false;
  }
}

/** Resolve the boot locale. Every input is injectable for tests. */
export function resolveLocale({
  location = globalThis.location,
  storage,
  languages = globalThis.navigator?.languages,
} = {}) {
  const fromQuery = queryLocale(location);
  if (fromQuery) return fromQuery;
  const stored = readStoredLocale(storage);
  if (stored) return stored;
  for (const candidate of Array.isArray(languages) ? languages : []) {
    const normalized = normalizeLocale(candidate);
    if (normalized) return normalized;
  }
  return DEFAULT_LOCALE;
}

/** Set <html lang> and <html dir>. */
export function applyDocumentLanguage(doc, locale = DEFAULT_LOCALE) {
  const root = doc?.documentElement;
  if (!root) return false;
  const normalized = normalizeLocale(locale) || DEFAULT_LOCALE;
  root.lang = normalized;
  root.dir = RTL_LOCALES.includes(normalized) ? 'rtl' : 'ltr';
  return true;
}
