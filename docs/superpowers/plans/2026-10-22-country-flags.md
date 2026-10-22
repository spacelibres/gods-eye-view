# Country Flag Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a country's flag SVG beside the country name wherever the interface already displays a country (airport card, navigation-aid card, and their Cesium description tables).

**Architecture:** A pure, Node-testable helper resolves a country code from a code or name (reusing the existing radio-country parser). A separate Vite-only module maps the 249 vendored SVG assets to hashed URLs. The flag URL is injected into the portable layer modules through a `countryFlagUrl` resolver parameter (defaulting to `() => null`) so the Vite-only `import.meta.glob` module never enters the Node unit-test graph.

**Tech Stack:** Vanilla JS + Vite 6 (`import.meta.glob` with `?url`), Cesium, `node:test`.

## Global Constraints

- No new npm dependency; the `flag-icons` SVGs are already vendored in `public/flags/` (249 files, MIT).
- No runtime CDN/third-party network; flags resolve to public asset URLs (`/flags/<code>.svg` under `BASE_URL`).
- User-visible text goes through `t()`/`msg()`; flags themselves carry no text (`alt=""`, `aria-hidden="true"`).
- The flag URL resolver is injected into the portable layer modules with a `() => null` default, so none of them import the flag module or any Vite-only construct.
- Node-tested modules: `src/layers/airports/model.js`, `src/layers/airports/references.js`, `src/layers/airports/index.js`, `src/overlays/airportReadout.js`. None of them import the flag module.
- Commit steps below are **conditional**: run `git commit` only if the user has explicitly authorized commits for this work (project rule §8). Otherwise stop at "tests pass" and leave the changes uncommitted.
- Source files are already in the working tree: `public/flags/*.svg` (do not re-add them in the commit steps below).
- **Execution deviation:** the asset resolver was folded into `src/data/countryFlag.js` as `countryFlagUrl` (a `public/flags/` URL builder) instead of a separate `countryFlagAssets.js` `import.meta.glob` module, because the package-boundary gate rejects unregistered asset imports. `src/data/countryFlag.js` is registered in the `application-components` and `application-layer-construction` groups in `scripts/package-boundaries.json`.

---

### Task 1: Pure country-code resolver

**Files:**
- Create: `src/data/countryFlag.js`
- Test: `src/data/countryFlag.test.mjs`

**Interfaces:**
- Consumes: `isRadioCountryCode`, `normalizeRadioCountryInput` from `src/data/radioCountry.js`.
- Produces: `countryFlagCode({ countryCode, countryName }) => string|null` (uppercase ISO alpha-2 or `null`).

- [ ] **Step 1: Write the failing test**

Create `src/data/countryFlag.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { countryFlagCode } from './countryFlag.js';

test('countryFlagCode resolves a valid ISO code directly', () => {
  assert.equal(countryFlagCode({ countryCode: 'us' }), 'US');
  assert.equal(countryFlagCode({ countryCode: 'GB' }), 'GB');
});

test('countryFlagCode resolves a known English country name to its code', () => {
  assert.equal(countryFlagCode({ countryName: 'United States' }), 'US');
  assert.equal(countryFlagCode({ countryName: 'France' }), 'FR');
});

test('countryFlagCode resolves an exonym through the shared parser', () => {
  assert.equal(countryFlagCode({ countryName: 'Turkey' }), 'TR');
  assert.equal(countryFlagCode({ countryName: 'Holland' }), 'NL');
});

test('countryFlagCode prefers a valid code over a name', () => {
  assert.equal(
    countryFlagCode({ countryCode: 'GB', countryName: 'United States' }),
    'GB',
  );
});

test('countryFlagCode fails closed for empty, unknown, and non-ISO values', () => {
  assert.equal(countryFlagCode(), null);
  assert.equal(countryFlagCode({}), null);
  assert.equal(countryFlagCode({ countryCode: '' }), null);
  assert.equal(countryFlagCode({ countryCode: 'XX' }), null);
  assert.equal(countryFlagCode({ countryName: 'Atlantis' }), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/data/countryFlag.test.mjs`
Expected: FAIL — `Cannot find module './countryFlag.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/data/countryFlag.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/data/countryFlag.test.mjs`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit (conditional)**

```bash
git add src/data/countryFlag.js src/data/countryFlag.test.mjs
git commit -m "feat: add country code resolver for flag lookup"
```

---

### Task 2: Vite asset resolver

**Files:**
- Create: `src/data/countryFlagAssets.js`

**Interfaces:**
- Consumes: `countryFlagCode` from `src/data/countryFlag.js`.
- Produces: `countryFlagUrl({ countryCode, countryName }) => string|null` (hashed SVG asset URL or `null`).

- [ ] **Step 1: Write the implementation**

Create `src/data/countryFlagAssets.js`:

```js
import { countryFlagCode } from './countryFlag.js';

const flagUrls = import.meta.glob('../assets/flags/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
});

const byCode = Object.create(null);
for (const [path, url] of Object.entries(flagUrls)) {
  const match = path.match(/([a-z]{2})\.svg$/);
  if (match) byCode[match[1]] = url;
}

/**
 * Flag SVG asset URL for a country code/name, or null when there is no flag.
 *
 * Browser-only: `import.meta.glob` is a Vite build feature, so this module is
 * never imported by Node unit tests (they use `countryFlagCode` directly).
 *
 * @param {{countryCode?: string|null, countryName?: string|null}} fields
 * @returns {string|null}
 */
export function countryFlagUrl({ countryCode, countryName } = {}) {
  const code = countryFlagCode({ countryCode, countryName });
  if (!code) return null;
  return byCode[code.toLowerCase()] || null;
}
```

- [ ] **Step 2: Commit (conditional)**

```bash
git add src/data/countryFlagAssets.js
git commit -m "feat: map country codes to vendored flag asset URLs"
```

Note: this module has no Node unit test (it cannot be imported under `node:test`); it is verified by `npm run build` in Task 7.

---

### Task 3: Airport card and description flags

**Files:**
- Modify: `src/layers/airports/model.js` (`airportReadout`, `airportDescription`)
- Modify: `src/overlays/airportReadout.js` (render flag in the Country `<dd>`)
- Modify: `src/ui/styles/overlays.css` (`.country-flag` sizing)
- Test: `src/layers/airports/index.test.mjs`, `src/overlays/airportReadout.test.mjs`

**Interfaces:**
- Consumes: nothing new; `airportReadout`/`airportDescription` gain an optional `countryFlagUrl = () => null` last parameter.
- Produces: `airportReadout` model gains a `countryFlag: string|null` field; `airportDescription` emits a `.country-flag` `<img>` in the Country row.

- [ ] **Step 1: Write the failing tests**

In `src/layers/airports/index.test.mjs`, add after the existing `airportReadout` tests:

```js
test('airport readout leaves countryFlag null without a resolver', () => {
  const model = airportReadout(airport(), {}, (v) => v);
  assert.equal(model.countryFlag, null);
});

test('airport readout resolves a country flag URL when a resolver is supplied', () => {
  const model = airportReadout(
    airport(),
    {},
    (v) => v,
    'en',
    () => '/assets/na.svg',
  );
  assert.equal(model.countryFlag, '/assets/na.svg');
});
```

In `src/overlays/airportReadout.test.mjs`, add a new test (the fake `Element` already supports `createElement`, `appendChild`, `setAttribute`, `getAttribute`):

```js
test('country rows render a flag image when the model carries one', () => {
  const f = fixture();
  f.entity.getAirportReadout = () => ({
    title: 'Airport',
    codes: [],
    rows: [['Country', 'China']],
    countryFlag: '/assets/cn.svg',
  });
  f.card.show(f.entity);
  const img = f
    .all()
    .find((n) => n.tagName === 'IMG' && n.className === 'country-flag');
  assert.ok(img, 'flag image is rendered');
  assert.equal(img.src, '/assets/cn.svg');
  assert.equal(img.getAttribute('aria-hidden'), 'true');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/layers/airports/index.test.mjs src/overlays/airportReadout.test.mjs`
Expected: the two new `airportReadout` assertions fail on `model.countryFlag === undefined`; the `airportReadout` DOM test fails (no `IMG.country-flag` found).

- [ ] **Step 3: Write the implementation**

In `src/layers/airports/model.js`:

Change the `airportReadout` signature and return object:

```js
export function airportReadout(
  a,
  p,
  t = (value) => value,
  locale = 'en',
  countryFlagUrl = () => null,
) {
  // ...existing body unchanged...
  return {
    title: a.name,
    symbol: airportSymbol(a, resolveAirportUsage(a).kind).image,
    codes,
    countryFlag: countryFlagUrl({
      countryCode: a.countryCode,
      countryName: a.country,
    }),
    rows: airportDetailRows(a, p, t)
      .filter(([label]) => facts.has(label))
      .map(([label, rawValue]) => {
        const value = label === 'Country' ? country : rawValue;
        return [
          label,
          value === null || value === undefined || value === ''
            ? t('Unknown')
            : value,
        ];
      }),
    source: p.source || 'OurAirports',
    sourceUrl: p.sourceUrl,
  };
}
```

Change `airportDescription`:

```js
export function airportDescription(
  a,
  p,
  t = (value) => value,
  countryFlagUrl = () => null,
) {
  const rows = airportDetailRows(a, p, t);
  const flag = countryFlagUrl({
    countryCode: a.countryCode,
    countryName: a.country,
  });
  return `<table>${rows
    .map(([label, value]) => {
      const cell =
        value === null || value === undefined || value === ''
          ? t('Unknown')
          : value;
      const flagImg =
        label === 'Country' && flag
          ? `<img class="country-flag" src="${escape(flag)}" alt="" aria-hidden="true">`
          : '';
      return `<tr><th>${escape(t(label))}</th><td>${flagImg}${escape(cell)}</td></tr>`;
    })
    .join('')}</table>`;
}
```

In `src/overlays/airportReadout.js`, replace the rows loop in `refresh()`:

```js
    for (const [label, value] of model.rows || []) {
      const field = make('div', 'airport-detail-field', fields);
      make('dt', '', field).textContent = t(label);
      const detail = make('dd', '', field);
      detail.setAttribute('translate', 'no');
      if (label === 'Country' && model.countryFlag) {
        const flag = make('img', 'country-flag', detail);
        flag.src = model.countryFlag;
        flag.alt = '';
        flag.setAttribute('aria-hidden', 'true');
        const text = make('span', 'country-flag-label', detail);
        text.textContent = value;
      } else {
        detail.textContent = value;
      }
    }
```

In `src/ui/styles/overlays.css`, append after `.airport-detail-field dd`:

```css
.country-flag {
  width: 1.25em;
  height: 0.9375em;
  object-fit: cover;
  border-radius: 2px;
  vertical-align: -0.125em;
  margin-right: 6px;
  box-shadow: 0 0 0 1px var(--glass-border);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/layers/airports/index.test.mjs src/overlays/airportReadout.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit (conditional)**

```bash
git add src/layers/airports/model.js src/overlays/airportReadout.js src/ui/styles/overlays.css src/layers/airports/index.test.mjs src/overlays/airportReadout.test.mjs
git commit -m "feat: render country flags in airport cards and descriptions"
```

---

### Task 4: Navigation-aid card and description flags

**Files:**
- Modify: `src/layers/airports/references.js` (`navaidReadout`, `createAviationReferences`, navaid description table)
- Test: `src/layers/airports/references.test.mjs`

**Interfaces:**
- Consumes: nothing new; `navaidReadout` and `createAviationReferences` gain an optional `countryFlagUrl = () => null` parameter.
- Produces: `navaidReadout` model gains a `countryFlag: string|null` field; the navaid description table emits a `.country-flag` `<img>` in the Country row.

- [ ] **Step 1: Write the failing test**

In `src/layers/airports/references.test.mjs`, add:

```js
test('navaid readout resolves a country flag URL when a resolver is supplied', async () => {
  const { navaidReadout } = await import('./references.js');
  const model = navaidReadout(
    {
      id: '1',
      name: 'Beacon',
      ident: 'ABC',
      type: 'VOR',
      countryCode: 'GB',
      country: 'United Kingdom',
    },
    { source: 'OurAirports' },
    (v) => v,
    'en',
    () => '/assets/gb.svg',
  );
  assert.equal(model.countryFlag, '/assets/gb.svg');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/layers/airports/references.test.mjs`
Expected: FAIL — `model.countryFlag` is `undefined`.

- [ ] **Step 3: Write the implementation**

In `src/layers/airports/references.js`:

Change the `navaidReadout` signature and return object (add `countryFlagUrl = () => null` and a `countryFlag` field):

```js
export function navaidReadout(
  a,
  p,
  t = (v) => v,
  locale = 'en',
  countryFlagUrl = () => null,
) {
  // ...existing excluded/country body unchanged...
  return {
    category: msg('Navaid'),
    title: a.name || a.ident || t('Navaid'),
    symbol: navaidSymbol(a.type),
    codes: a.ident ? [{ label: t('Ident'), value: a.ident }] : [],
    countryFlag: countryFlagUrl({
      countryCode: a.countryCode,
      countryName: a.country,
    }),
    rows: navaidDetailRows(a, p)
      .filter(
        ([label, value]) =>
          !excluded.has(label) &&
          value !== null &&
          value !== undefined &&
          value !== '',
      )
      .map(([label, value]) => [label, label === 'Country' ? country : value]),
  };
}
```

In `createAviationReferences`, add `countryFlagUrl = () => null,` to the destructured parameters (after `loadCountries = ...`).

In the navaid entity build (inside `update()`), change the `rows`/description lines:

```js
              const p = {
                  ...a,
                  source: result.source || 'OurAirports',
                  sourceUrl: result.sourceUrl,
                  revision: result.revision,
                  updatedAt: result.updatedAt,
                },
                rows = navaidDetailRows(a, p),
                navaidFlag = countryFlagUrl({
                  countryCode: a.countryCode,
                  countryName: a.country,
                });
```

and the description line:

```js
                description: `<table>${rows
                  .map(
                    ([k, v]) =>
                      `<tr><th>${escape(t(k))}</th><td>${k === 'Country' && navaidFlag ? `<img class="country-flag" src="${escape(navaidFlag)}" alt="" aria-hidden="true">` : ''}${escape(v ?? t('Unknown'))}</td></tr>`,
                  )
                  .join('')}</table>`,
```

and the readout line:

```js
              entity.getAirportReadout = () =>
                navaidReadout(a, p, t, getLocale(), countryFlagUrl);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/layers/airports/references.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit (conditional)**

```bash
git add src/layers/airports/references.js src/layers/airports/references.test.mjs
git commit -m "feat: render country flags in navigation-aid cards"
```

---

### Task 5: Wire the resolver into the layer composition

**Files:**
- Modify: `src/layers/airports/index.js` (accept and forward `countryFlagUrl`)
- Modify: `src/app/layers/airports.js` (import `countryFlagUrl` and pass it)

**Interfaces:**
- Consumes: `countryFlagUrl` from `src/data/countryFlagAssets.js`.
- Produces: the running app now resolves real flag URLs (no visible change until this task is done).

- [ ] **Step 1: Write the implementation**

In `src/layers/airports/index.js`, add `countryFlagUrl = () => null,` to the destructured options of `createAirportsLayer` (after `loadCountries,`), forward it to `createAviationReferences` (add `countryFlagUrl,` to its options object), and update the two call sites:

```js
              description: airportDescription(a, context.properties, t, countryFlagUrl),
```

and

```js
            entity.getAirportReadout = () =>
              airportReadout(a, context.properties, t, getLocale(), countryFlagUrl);
```

In `src/app/layers/airports.js`, add the import and the option:

```js
import { countryFlagUrl } from '../../data/countryFlagAssets.js';
```

and inside the `createAirportsLayer({...})` object add:

```js
    countryFlagUrl,
```

- [ ] **Step 2: Run the airport unit tests to verify nothing regressed**

Run: `node --test src/layers/airports/index.test.mjs src/layers/airports/references.test.mjs src/data/countryFlag.test.mjs src/overlays/airportReadout.test.mjs`
Expected: PASS.

- [ ] **Step 3: Commit (conditional)**

```bash
git add src/layers/airports/index.js src/app/layers/airports.js
git commit -m "feat: wire flag resolver into the airports layer"
```

---

### Task 6: License, attribution, and runtime docs

**Files:**
- Modify: `THIRD_PARTY_NOTICES.md`
- Modify: `DATA_SOURCES.md`
- Modify: `docs/CURRENT-STATE.md`

**Interfaces:** none.

- [ ] **Step 1: Add the flag-icons notice**

Append a `flag-icons` entry to `THIRD_PARTY_NOTICES.md` with the exact license text:

```text
flag-icons (https://github.com/lipis/flag-icons)

Copyright (c) 2013 Panayiotis Lipiridis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Record the data-source attribution**

Add a `flag-icons` row under the bundled-snapshots section of `DATA_SOURCES.md`, noting: 249 ISO 3166-1 alpha-2 flag SVGs in `src/assets/flags/`, MIT license, source `https://github.com/lipis/flag-icons`, used only to render a country flag beside country names.

- [ ] **Step 3: Update the runtime reference**

In `docs/CURRENT-STATE.md`, under the Airports/navaid description, add one sentence: airport and navigation-aid detail cards and their Cesium description tables now show the country's flag (`flag-icons`, MIT, vendored in `src/assets/flags/`) beside the country name, resolved from the directory's ISO country code.

- [ ] **Step 4: Commit (conditional)**

```bash
git add THIRD_PARTY_NOTICES.md DATA_SOURCES.md docs/CURRENT-STATE.md
git commit -m "docs: record flag-icons license and runtime behavior"
```

---

### Task 7: Full validation

- [ ] **Step 1: Formatting and boundaries**

Run: `npm run format:check` then `npm run check:boundaries`
Expected: PASS (no format or boundary violations). If `npm run format` is needed, run it and note the change.

- [ ] **Step 2: i18n**

Run: `npm run i18n`
Expected: PASS; no new unmarked UI text (the flag `<img>` carries no text).

- [ ] **Step 3: Unit suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: PASS; the 249 SVGs are emitted as hashed assets and the app bundles without `import.meta.glob` errors.

- [ ] **Step 5: Feature gates (needs a dev server)**

With `npm run dev` running on `http://localhost:4173`, run:

```bash
node scripts/qa-airports.mjs --url http://localhost:4173
node scripts/qa-radio.mjs --url http://localhost:4173
```

Expected: the airport gate's card checks pass; radio gate passes (radio is unaffected but confirms no regression). If a gate needs a provider key that is unavailable, report which one and what remains unverified rather than claiming a pass.

- [ ] **Step 6: Report**

List changed files and the exact commands/results, including any gate that could not run and why.
