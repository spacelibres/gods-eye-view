import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { prepareStaticAssets } from '../../scripts/prepare-static-assets.mjs';

const body = Buffer.from('fixture-font');
const asset = {
  file: 'fixture.woff2',
  url: 'https://fonts.gstatic.com/fixture.woff2',
  bytes: body.length,
  sha256: createHash('sha256').update(body).digest('hex'),
};

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'gev-static-assets-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('downloads pinned bytes, reuses verified cache and repairs corruption', () =>
  fixture(async (directory) => {
    let requests = 0;
    const options = {
      directory,
      assets: [asset],
      fetchImpl: async () => {
        requests++;
        return new Response(body);
      },
    };
    await prepareStaticAssets(options);
    assert.deepEqual(await readFile(join(directory, asset.file)), body);
    await prepareStaticAssets(options);
    assert.equal(requests, 1);
    await writeFile(join(directory, asset.file), 'corrupt');
    await prepareStaticAssets(options);
    assert.equal(requests, 2);
    assert.deepEqual(await readFile(join(directory, asset.file)), body);
  }));

test('rejects wrong hashes, oversized responses and HTTP failures without publishing', () =>
  fixture(async (directory) => {
    for (const response of [
      new Response('wrong bytes!!'),
      new Response(Buffer.alloc(100)),
      new Response('unavailable', { status: 503 }),
    ]) {
      await assert.rejects(
        prepareStaticAssets({
          directory,
          assets: [asset],
          fetchImpl: async () => response,
        }),
      );
      await assert.rejects(readFile(join(directory, asset.file)), {
        code: 'ENOENT',
      });
    }
  }));

test('rejects output traversal before any network request', () =>
  fixture(async (directory) => {
    await assert.rejects(
      prepareStaticAssets({
        directory,
        assets: [{ ...asset, file: '../escape' }],
        fetchImpl: () => assert.fail('must not fetch'),
      }),
    );
  }));
