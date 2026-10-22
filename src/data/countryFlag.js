import {
  isRadioCountryCode,
  normalizeRadioCountryInput,
} from './radioCountry.js';

/**
 * Resolve a country's ISO 3166-1 alpha-2 code from a code and/or a name.
 *
 * A recognized code is used directly; otherwise a country name is resolved
 * through the shared radio country parser (name → code). Empty, unknown, or
 * non-ISO values fail closed to `null`.
 *
 * @param {{countryCode?: string|null, countryName?: string|null}} fields
 * @returns {string|null} Uppercase alpha-2 code, or null when unknown.
 */
export function countryFlagCode({ countryCode, countryName } = {}) {
  if (typeof countryCode === 'string' && isRadioCountryCode(countryCode)) {
    return countryCode.toUpperCase();
  }
  if (typeof countryName === 'string') {
    const resolved = normalizeRadioCountryInput(countryName);
    if (resolved.valid && !resolved.empty) return resolved.code;
  }
  return null;
}

/**
 * Flag SVG URL for a country code/name, or null when there is no flag.
 *
 * Flags ship as public assets under `public/flags/<code>.svg` (one per ISO
 * 3166-1 alpha-2 code, vendored from `flag-icons`, MIT). The URL is resolved
 * against the app's base path so it works under any deployment prefix.
 *
 * @param {{countryCode?: string|null, countryName?: string|null}} fields
 * @returns {string|null}
 */
export function countryFlagUrl({ countryCode, countryName } = {}) {
  const code = countryFlagCode({ countryCode, countryName });
  if (!code) return null;
  return `${import.meta.env?.BASE_URL || '/'}flags/${code.toLowerCase()}.svg`;
}
