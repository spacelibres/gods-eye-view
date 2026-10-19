// The one list of shipped locales. locale.js derives LOCALES, LOCALE_NAMES
// and RTL_LOCALES from it; adding a language starts here.
//
// name is the locale's own name, shown in the picker. dir stays 'ltr' until
// the HUD and panel CSS are mirrored. Add a locale only when its catalog is
// complete: `npm run i18n` fails on a shipped locale without one.
//
// Planned but not yet shipped (add with their catalog): fr, de, it, nl,
// pt-BR, pl, sv, cs, ro, uk, tr, hi, id, th, vi.

export const LOCALE_REGISTRY = Object.freeze([
  { code: 'en', name: 'English', dir: 'ltr' },
  { code: 'es', name: 'Español', dir: 'ltr' },
  { code: 'ru', name: 'Русский', dir: 'ltr' },
  { code: 'zh-CN', name: '简体中文', dir: 'ltr' },
  { code: 'zh-TW', name: '繁體中文', dir: 'ltr' },
  { code: 'ja', name: '日本語', dir: 'ltr' },
  { code: 'ko', name: '한국어', dir: 'ltr' },
]);
