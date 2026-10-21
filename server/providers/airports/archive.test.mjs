import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  AIRPORT_SOURCE_FILES,
  writeSourceArchive,
  hasSourceArchive,
  readArchivedSource,
} from './archive.js';
const revision = 'a'.repeat(40);
function fixture() {
  const files = Object.fromEntries(
    AIRPORT_SOURCE_FILES.map((name) => [name, 'id,name\n1,Airport\n']),
  );
  return {
    files,
    provenance: {
      revision,
      files: Object.fromEntries(
        Object.entries(files).map(([n, text]) => [
          n,
          {
            bytes: Buffer.byteLength(text),
            sha256: createHash('sha256').update(text).digest('hex'),
          },
        ]),
      ),
    },
  };
}
test('complete source archive is durable and reads never fetch upstream', async () => {
  const root = await mkdtemp(join(tmpdir(), 'airport-archive-'));
  try {
    const { files, provenance } = fixture();
    await writeSourceArchive(root, provenance, files);
    assert.equal(
      await hasSourceArchive(join(root, 'raw', revision), provenance),
      true,
    );
    assert.equal(
      (await readArchivedSource(root, provenance, 'runways.csv')).toString(),
      files['runways.csv'],
    );
    await assert.rejects(
      readArchivedSource(root, provenance, '../../state.json'),
    );
    await writeSourceArchive(root, provenance, files);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('partial or mismatched sources cannot publish an archive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'airport-archive-'));
  try {
    const { files, provenance } = fixture();
    delete files['runways.csv'];
    await assert.rejects(writeSourceArchive(root, provenance, files));
    assert.equal(
      await hasSourceArchive(join(root, 'raw', revision), provenance),
      false,
    );
    const complete = fixture();
    complete.files['airports.csv'] = 'corrupt';
    await assert.rejects(
      writeSourceArchive(root, complete.provenance, complete.files),
    );
    await assert.rejects(readFile(join(root, 'raw', revision, 'airports.csv')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a corrupt published archive is repaired without discarding valid source data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'airport-archive-'));
  try {
    const { files, provenance } = fixture();
    await writeSourceArchive(root, provenance, files);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(root, 'raw', revision, 'runways.csv'), 'broken');
    await writeSourceArchive(root, provenance, files);
    assert.equal(
      await hasSourceArchive(join(root, 'raw', revision), provenance),
      true,
    );
    await Promise.all([
      writeSourceArchive(root, provenance, files),
      writeSourceArchive(root, provenance, files),
    ]);
    assert.equal(
      (await readArchivedSource(root, provenance, 'runways.csv')).toString(),
      files['runways.csv'],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('concurrent initial seeding preserves one complete archive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'airport-archive-'));
  try {
    const { files, provenance } = fixture();
    await Promise.all([
      writeSourceArchive(root, provenance, files),
      writeSourceArchive(root, provenance, files),
    ]);
    assert.equal(
      await hasSourceArchive(join(root, 'raw', revision), provenance),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
