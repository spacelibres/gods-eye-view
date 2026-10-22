# Country Flag Icons — Global Display Design

Status: user confirmed SVG format, sourced from `flag-icons` (MIT). Scope is "show a flag wherever the source data already carries a country code or a resolvable country name; do not force a flag where there is no country data". The 249 ISO 3166-1 alpha-2 flag SVGs are vendored in `public/flags/` and the helper is implemented.

## Goal and scope

Wherever the interface shows data for a country (airports, navigation aids, radio, regional context, civil aircraft, …), show that country's flag beside the country name. Flags are SVG, shipped with the build, with no CDN, no runtime third-party network request, and no new npm dependency.

**Add flag (source data has a country field)**

- Airport card "Country" row (`src/overlays/airportReadout.js` + `src/layers/airports/model.js`).
- Navigation-aid card "Country" row (`src/layers/airports/references.js`).
- Airport Cesium description table (`airportDescription` in `model.js`, the HTML table inside the InfoBox).
- Radio card: confirm during implementation whether it displays country text; add the flag only if it does (`src/layers/radio/`).
- Regional context / HUD locality: confirm during implementation whether it displays country text; add the flag only if it does (`src/data/regionalModel.js` and the related HUD).
- Civil aircraft `originCountry`: an English country name; resolve it name→code and show the flag (flights card/readout, if that field is displayed).

**Do not add a flag**

- Vessels (AIS): the source data has no country / flag-state field.
- Military aircraft: `originCountry` is always `null` (the adsb.lol source has no such field).
- MCP tools / voice plain-text output (`src/tools/`, for AI clients; no UI).
- Natural Earth country geometry text labels (map text, not a "country data row"; no icon overlaid).

## Asset strategy

- Source: `flag-icons` (github.com/lipis/flag-icons, MIT), using its `4x3` SVGs for a uniform 4:3 display ratio; non-4:3 flags are padded to 4:3 upstream.
- Files are named by lowercase ISO 3166-1 alpha-2 (`us.svg`, `gb.svg`, …), vendored into `public/flags/` (served as public assets, like `public/models/`), covering the same code set as the existing `countryCode` fields (OurAirports 249 countries/territories and the ISO list in `radioCountry.js`). Exactly 249 files; the package's non-ISO / sub-national extras (`eu`, `un`, `xk`, `arab`, `asean`, `gb-eng`, …) are excluded.
- `countryFlagUrl` builds a `/flags/<code>.svg` URL resolved against `import.meta.env.BASE_URL`, so it works under any deployment prefix. No `import.meta.glob` (the project's package-boundary gate rejects unregistered asset imports), no CDN, no runtime third-party request.
- Asset cost: about 2 MB of SVGs copied to `dist/flags/` by the build, fetched on demand from the app's own origin.
- License and attribution recorded in `THIRD_PARTY_NOTICES.md` and `DATA_SOURCES.md` (MIT, "Copyright (c) 2013 Panayiotis Lipiridis"), shipped with releases.

## Core helper and boundary

- `src/data/countryFlag.js`: pure functions, no DOM/Cesium/Vite dependency, directly unit-testable under Node `node:test`.
  - `countryFlagCode({ countryCode, countryName })` → an ISO alpha-2 code or `null`. With a code, validate it (reuse `isRadioCountryCode` from `radioCountry.js`); with only a name, resolve name→code via `normalizeRadioCountryInput` (reuse the existing mapping; no duplication, no code moved).
  - `countryFlagUrl({ countryCode, countryName })` → a `/flags/<code>.svg` URL (BASE_URL-resolved) or `null`. No Vite-only constructs.
- The flag URL is injected into the portable layer modules through a `countryFlagUrl` resolver parameter (default `() => null`) so the layers stay Node-testable; the application composition (`src/app/layers/airports.js`) binds the real `countryFlagUrl`.
- Reuse the existing ISO code table and name mapping in `src/data/radioCountry.js`; do not move its code or change its external behavior.

## Integration

At each existing "Country" text position, show the flag URL via an `<img src>`; `alt=""`, `aria-hidden="true"` (the icon is decorative, the country name remains translated text). The country name keeps the existing `translate="no"` handling (provider data).

- `airportReadout` / `navaidReadout`: the "Country" row additionally carries a flag URL, or `airportReadout.js` injects the flag into the "Country" `<dd>` using `countryFlagCode`/`countryFlagUrl`.
- `airportDescription`: insert a flag `<img>` into the Country `<td>` of the `<table>`.
- Other surfaces are added one by one under the rule "only if country text is actually shown".

## Verification

- `npm run i18n` passes (any new user-visible text still goes through `t()`/`msg()`; the flag itself carries no text).
- `npm test` passes, including `countryFlagCode` unit tests: direct code lookup, name reverse lookup (`United States` → `US`), empty/unknown values return `null`, non-ISO codes fail closed.
- `npm run build` passes; `npm run format:check` and `npm run check:boundaries` pass.
- Related gates: `scripts/qa-airports.mjs` (airport card) and `scripts/qa-radio.mjs` (radio) pass locally where a dev server is required.
- With external hosts blocked / offline, flags still render (assets are served from the app's own build).

## Documentation and release

- `docs/CURRENT-STATE.md` records the runtime behavior change.
- `THIRD_PARTY_NOTICES.md` and `DATA_SOURCES.md` record the `flag-icons` MIT license and attribution.
- No version bump, no new dependency, no deployment/VPS state change.

## Open items

- Whether the radio card and HUD locality actually render country text: the implementation rule is "add the flag only if country text is shown"; if it is not shown, do not add it, and report the real coverage in the final summary.
