// One texture per facility/use combination; tint is supplied by the host theme.
const msg = (value) => value;
const cache = new Map();
const legendCache = new Map();
const outlinedLines = (path, width = 2) =>
  `<path d="${path}" fill="none" stroke="black" stroke-width="${width + 2}"/><path d="${path}" fill="none" stroke="white" stroke-width="${width}"/>`;
const airliner =
  '<path d="M16 2c-1 0-2 1-2 3v7L3 20v3l11-4v6l-4 3v2l6-2 6 2v-2l-4-3v-6l11 4v-3l-11-8V5c0-2-1-3-2-3Z"/><path d="M8 17v5m16-5v5" stroke-width="3"/>';
const fighter =
  '<path d="m16 1-3 11-2 3-9 8v3l10-3-1 5-4 2v1l9-2 9 2v-1l-4-2-1-5 10 3v-3l-9-8-2-3Z"/><path d="M16 9v17" fill="none"/>';
const propeller =
  '<path d="M14 8V4h4v4l2 6 10 2v4l-11-1v7l5 2v3l-8-2-8 2v-3l5-2v-7L2 20v-4l10-2Z"/><path d="M8 5h16" stroke-width="2"/>';
const helicopter =
  '<ellipse cx="20" cy="18" rx="5" ry="9"/>' +
  outlinedLines('M18 26v8h4v-8M10 32h20M7 6h26M20 2v8M11 12v17m18-17v17', 2.5) +
  '<path d="M17 13h6v6h-6Z" fill="black" stroke="none"/>';
const balloon =
  '<path d="M20 3C5 3 5 18 13 25l3 5h8l3-5C35 18 35 3 20 3Z"/><path d="M20 4c-7 7-7 15 0 25 7-10 7-18 0-25Z" fill="none"/>' +
  outlinedLines('M16 30v5h8v-5');
const militaryBadge =
  '<path d="m32 2 6 2v6l-6 5-6-5V4Z"/><path d="m32 5 1 2h2l-2 2 1 2-2-1-2 1 1-2-2-2h2Z" fill="black" stroke="none"/>';
const jointBadge =
  '<circle cx="32" cy="8" r="7"/><path d="M32 2v12M27 8h10" fill="none" stroke-width="2"/>';
const unknownBadge =
  '<circle cx="32" cy="8" r="6"/><text x="32" y="11" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" font-weight="bold" fill="black" stroke="none">?</text>';

export function airportSymbol(airport, usage = 'unknown') {
  usage = ['civil', 'military', 'joint'].includes(usage) ? usage : 'unknown';
  const facility =
    airport.type === 'heliport'
      ? 'helicopter'
      : airport.type === 'seaplane_base'
        ? 'seaplane'
        : airport.type === 'balloonport'
          ? 'balloon'
          : usage === 'civil'
            ? 'airliner'
            : usage === 'military'
              ? 'fighter'
              : usage === 'joint'
                ? 'joint'
                : 'airfield';
  const kind = `${facility}:${usage}`;
  if (cache.has(kind)) return cache.get(kind);
  const fixed = (shape) => `<g transform="translate(4 4)">${shape}</g>`;
  let shape;
  if (facility === 'helicopter') shape = helicopter;
  else if (facility === 'balloon') shape = balloon;
  else if (facility === 'seaplane')
    shape = `<g transform="translate(6 0) scale(.85)">${airliner}</g>${outlinedLines('M3 34q4-4 8 0t8 0 8 0 10 0')}`;
  else if (facility === 'joint')
    shape = `<g transform="translate(0 1) scale(.78)">${airliner}</g><g transform="translate(17 15) scale(.65)">${fighter}</g>`;
  else
    shape = fixed(
      facility === 'airliner'
        ? airliner
        : facility === 'fighter'
          ? fighter
          : propeller,
    );
  if (['helicopter', 'seaplane', 'balloon'].includes(facility))
    shape +=
      usage === 'military'
        ? militaryBadge
        : usage === 'joint'
          ? jointBadge
          : '';
  else if (facility === 'airfield') shape += unknownBadge;
  const label =
    facility === 'helicopter'
      ? msg('Heliport')
      : facility === 'seaplane'
        ? msg('Seaplane base')
        : facility === 'balloon'
          ? msg('Balloonport')
          : usage === 'civil'
            ? msg('Civil aviation service confirmed')
            : usage === 'military'
              ? msg('Military airfield')
              : usage === 'joint'
                ? msg('Joint-use airfield')
                : msg('Airport usage unconfirmed');
  const image =
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 40 40"><g fill="white" stroke="black" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">${shape}</g></svg>`,
    );
  const symbol = Object.freeze({ kind, facility, label, image });
  cache.set(kind, symbol);
  return symbol;
}

export function airportLegendImage(symbol, color = '#ffffff') {
  const tint = /^(?:#[a-f\d]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(color)
    ? color
    : '#ffffff';
  const key = `${symbol.kind}:${tint}`;
  if (legendCache.has(key)) return legendCache.get(key);
  const svg = decodeURIComponent(
    symbol.image.slice(symbol.image.indexOf(',') + 1),
  )
    .replaceAll('fill="white"', `fill="${tint}"`)
    .replaceAll('stroke="white"', `stroke="${tint}"`);
  const image = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  if (legendCache.size >= 128)
    legendCache.delete(legendCache.keys().next().value);
  legendCache.set(key, image);
  return image;
}
