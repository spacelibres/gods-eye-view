#!/usr/bin/env node
// Renders the home-screen and favicon rasters from `public/icons/logo-square.svg`.
//
// Re-run after changing the logo: `node scripts/generate-icons.mjs`. The output
// is committed, because the install icons have to exist in a plain `vite build`
// and contributors should not need an image toolchain to ship the app.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REPO_ROOT = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
);
const LOGO = path.join(REPO_ROOT, 'public', 'icons', 'logo-square.svg');
const OUT_DIR = path.join(REPO_ROOT, 'public', 'icons');

/**
 * `--bg-dark` from src/ui/styles/foundation.css, so the tile matches the app.
 * The mark is the manual's monochrome white symbol, which reads on any palette.
 */
const BACKGROUND = '#071424';

/**
 * Fraction of the canvas the mark is allowed to occupy.
 *
 * A maskable icon may be cropped to a circle inscribed in the middle 80% of the
 * square, so its mark stays well inside that circle; the other icons are shown
 * as drawn and only need optical breathing room.
 */
const INSET = { normal: 0.78, maskable: 0.54 };

const TARGETS = [
  { file: 'icon-32.png', size: 32, inset: INSET.normal },
  { file: 'icon-180.png', size: 180, inset: INSET.normal },
  { file: 'icon-192.png', size: 192, inset: INSET.normal },
  { file: 'icon-512.png', size: 512, inset: INSET.normal },
  { file: 'icon-512-maskable.png', size: 512, inset: INSET.maskable },
];

/** Fit the logo inside `size * inset` and centre it on an opaque square. */
async function render(svg, { size, inset }) {
  const box = Math.round(size * inset);
  // The square logo fills the box 1:1, so `contain` is an exact scale; the
  // composite below centres it on the opaque canvas.
  const mark = await sharp(svg, { density: 384 })
    .resize(box, box, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BACKGROUND,
    },
  })
    .composite([{ input: mark, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const svg = await readFile(LOGO);
await mkdir(OUT_DIR, { recursive: true });
for (const target of TARGETS) {
  await writeFile(path.join(OUT_DIR, target.file), await render(svg, target));
  console.log(`icons: wrote ${target.file} (${target.size}px)`);
}
