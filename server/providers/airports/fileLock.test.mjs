import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { acquireFileLock } from './fileLock.js';
test('live owners cannot be removed, release is token checked and dead child locks recover', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'airport-lock-'));
  const path = join(dir, 'writer.lock');
  let child;
  try {
    const release = await acquireFileLock(path);
    await assert.rejects(acquireFileLock(path), /locked/i);
    const original = await readFile(path, 'utf8');
    await writeFile(
      path,
      JSON.stringify({
        ...JSON.parse(original),
        token: '00000000-0000-0000-0000-000000000001',
      }),
    );
    await release();
    assert.equal(
      JSON.parse(await readFile(path, 'utf8')).token,
      '00000000-0000-0000-0000-000000000001',
    );
    await rm(path);
    const url = pathToFileURL(
      join(process.cwd(), 'server/providers/airports/fileLock.js'),
    ).href;
    child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import {acquireFileLock} from ${JSON.stringify(url)};await acquireFileLock(${JSON.stringify(path)});console.log('ready');setInterval(()=>{},1000);`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    await once(child.stdout, 'data');
    const stopped = once(child, 'exit');
    child.kill('SIGKILL');
    await stopped;
    const recovered = await acquireFileLock(path);
    await recovered();
    await assert.rejects(readFile(path), { code: 'ENOENT' });
  } finally {
    child?.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
