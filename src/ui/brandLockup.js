/**
 * The spacelibre lockup, recoloured live from the active palette.
 *
 * The identity manual ships the lockup as one indivisible vector: a symbol and
 * a wordmark drawn as paths. Its colour is a setting rather than a constant, so
 * the mark has to follow whichever primary is in force. An `<img>` cannot do
 * that — an SVG loaded as an image cannot see the page's custom properties — so
 * the official file is inlined instead. Only `fill` and `stroke` attributes are
 * replaced; every path, transform and mask stays byte-for-byte as published,
 * so the geometry can never be deformed by this step.
 *
 * The file is read from `public/brand/` on mount, so the assets stay the single
 * source of truth and the loader falls back to the plain image if fetching
 * fails.
 */

/**
 * The official files paint three roles. The reverse lockup has no separate
 * planet colour — its ring is drawn in the ink — so the ring is recoloured
 * through `[data-stroke-role="planet"]` in the stylesheet, where the palette's
 * secondary role can give it a colour of its own on the deep background.
 */
const ROLE_COLOURS = Object.freeze([
  ['#2997ff', 'var(--sp-logo-primary, #2997FF)'],
  ['#007bff', 'var(--sp-logo-primary, #2997FF)'],
  ['#002044', 'var(--sp-logo-planet, #002044)'],
  ['#edf4ff', 'var(--sp-logo-ink, #EDF4FF)'],
]);

/* Built fresh for each call: a `g` regex carries `lastIndex` between calls. */
const paintAttribute = () => /[ \t\n<](fill|stroke)=(["'])([^"']*)\2/gi;

/**
 * Replace one exact colour literal in the paint attributes of a document.
 *
 * The stencil inside `<mask>` is mask geometry rather than the mark, so it is
 * left exactly as published; every other `fill`/`stroke` is fair game.
 */
function paintReplace(fragment, hex, token) {
  const wanted = hex.toLowerCase();
  let result = '';
  let cursor = 0;
  for (const match of fragment.matchAll(paintAttribute())) {
    if (match[3].toLowerCase() !== wanted) continue;
    // Keep the whitespace or `<` that the match consumed as a boundary.
    const attributeStart = match.index + match[0].indexOf(match[1]);
    if (insideMask(fragment, attributeStart)) continue;
    result += fragment.slice(cursor, attributeStart);
    result += `${match[1]}=${match[2]}${token}${match[2]}`;
    cursor = match.index + match[0].length;
  }
  return cursor === 0 ? fragment : result + fragment.slice(cursor);
}

/** True when the offset falls inside a `<mask>` element. */
function insideMask(markup, offset) {
  const before = markup.slice(0, offset);
  return before.lastIndexOf('<mask') > before.lastIndexOf('</mask>');
}

/**
 * Replace the published colour literals with the palette roles.
 *
 * Only the colour inside a `fill` or `stroke` attribute is touched — never the
 * path data, a transform or an id. The geometry inside `<mask>` is a stencil
 * rather than the mark itself, so it is left exactly as published.
 */
export function recolourLockup(source) {
  return ROLE_COLOURS.reduce(
    (svg, [hex, token]) => paintReplace(svg, hex, token),
    source,
  );
}

/** The markup for one lockup, ready to insert. */
export function lockupMarkup(source, alt = 'spacelibre') {
  const recoloured = recolourLockup(source).replace(
    /<title>[^<]*<\/title>/,
    '',
  );
  return recoloured.replace(
    /<svg\b([^>]*)>/,
    `<svg$1 role="img" aria-label="${alt}" focusable="false">`,
  );
}

const cache = new Map();

async function loadLockup(url) {
  if (!cache.has(url)) {
    cache.set(
      url,
      fetch(url, { credentials: 'same-origin' })
        .then((response) => {
          if (!response.ok) throw new Error(`${response.status} ${url}`);
          return response.text();
        })
        .catch(() => null),
    );
  }
  return cache.get(url);
}

/**
 * Inline every `[data-logo-src]` holder in `root` with the lockup it names.
 *
 * The static `<img>` stays in the markup, so the mark is visible before this
 * runs and stays visible if the fetch fails; it is hidden by `.brand-logo--inline`
 * once the vector is in place, so only one copy reaches the accessibility tree.
 *
 * @param {Document|Element} [root] Where to look for logo holders.
 * @returns {Promise<void>} Resolves once every holder has been handled.
 */
export async function mountBrandLockups(root = globalThis.document) {
  if (!root?.querySelectorAll) return;
  const holders = [...root.querySelectorAll('[data-logo-src]')];
  await Promise.all(
    holders.map(async (holder) => {
      const source = await loadLockup(holder.dataset.logoSrc);
      if (!source || !holder.isConnected) return;
      const alt =
        holder.querySelector('img')?.getAttribute('alt')?.trim() ||
        'spacelibre';
      holder.innerHTML = lockupMarkup(source, alt);
      holder.classList.add('brand-logo--inline');
    }),
  );
}
