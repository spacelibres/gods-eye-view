#!/usr/bin/env node
/** Download pinned UI fonts/licenses before building; never runs in the browser.
 * npm run assets:prepare — verified local files need no network access.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const digest = (body) => createHash('sha256').update(body).digest('hex');

export async function prepareStaticAssets({
  directory = join(root, 'public/vendor-fonts'),
  assets,
  fetchImpl = globalThis.fetch,
} = {}) {
  assets ??= JSON.parse(
    await readFile(join(root, 'scripts/static-assets.json'), 'utf8'),
  ).assets;
  for (const asset of assets) {
    const url = new URL(asset.url);
    if (
      !asset.file ||
      basename(asset.file) !== asset.file ||
      /[\\/]/.test(asset.file) ||
      asset.file === '.' ||
      asset.file === '..' ||
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !['fonts.gstatic.com', 'raw.githubusercontent.com'].includes(
        url.hostname,
      ) ||
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes <= 0 ||
      asset.bytes > 2_000_000 ||
      !/^[a-f0-9]{64}$/.test(asset.sha256)
    )
      throw new Error('Invalid static asset manifest entry');
  }
  await mkdir(directory, { recursive: true });
  let downloaded = 0;
  for (const asset of assets) {
    const target = join(directory, asset.file);
    try {
      const cached = await readFile(target);
      if (cached.length === asset.bytes && digest(cached) === asset.sha256)
        continue;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const response = await fetchImpl(asset.url, {
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Static asset HTTP ${response.status}: ${asset.file}`);
    }
    const chunks = [];
    let bytes = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > asset.bytes)
          throw new Error(`Static asset exceeds pinned size: ${asset.file}`);
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const body = Buffer.concat(chunks);
    if (body.length !== asset.bytes || digest(body) !== asset.sha256)
      throw new Error(`Static asset integrity mismatch: ${asset.file}`);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, body, { flag: 'wx' });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
    downloaded++;
  }
  return { files: assets.length, downloaded };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const result = await prepareStaticAssets();
    console.log(
      `Static assets verified: ${result.files}; downloaded: ${result.downloaded}`,
    );
  } catch (error) {
    console.error(`Static asset preparation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
