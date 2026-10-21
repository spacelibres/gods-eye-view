/** The standalone tool catalog for voice, loaded the first time voice needs it. */

import { getLocale } from '../i18n/index.js';

let pending = null;

export function loadToolCatalog() {
  pending ??= Promise.all([
    import('../tools/index.js'),
    import('../tools/services.js'),
  ]).then(
    ([
      { composeCatalog, coreTools, catalogForSurface },
      { createToolServices },
    ]) =>
      catalogForSurface(
        composeCatalog({
          tools: coreTools,
          services: createToolServices({
            fetchImpl: (...args) => globalThis.fetch(...args),
            appUrl: new URL(globalThis.document.baseURI).origin,
            // Place names follow the language the user is reading the UI in.
            getLocale,
          }),
        }),
        'voice',
      ),
  );
  pending.catch(() => {
    pending = null;
  });
  return pending;
}
