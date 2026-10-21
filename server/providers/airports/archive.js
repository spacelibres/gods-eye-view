import {
  readFile,
  mkdir,
  mkdtemp,
  writeFile,
  rename,
  rm,
} from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const AIRPORT_SOURCE_FILES = Object.freeze([
  'airports.csv',
  'countries.csv',
  'regions.csv',
  'navaids.csv',
  'runways.csv',
  'airport-frequencies.csv',
]);
export const BUNDLED_SOURCE_DIR = new URL(
  '../../data/airports/raw/',
  import.meta.url,
);
const validRevision = (revision) => /^[a-f0-9]{40}$/.test(revision || '');
function verify(body, expected) {
  return (
    expected?.bytes === body.byteLength &&
    expected.sha256 === createHash('sha256').update(body).digest('hex')
  );
}
function filePath(directory, name) {
  return directory instanceof URL
    ? new URL(name, directory)
    : join(directory, name);
}
export async function hasSourceArchive(directory, provenance) {
  if (!AIRPORT_SOURCE_FILES.every((name) => provenance?.files?.[name]))
    return false;
  try {
    for (const name of AIRPORT_SOURCE_FILES) {
      if (
        !verify(
          await readFile(filePath(directory, name)),
          provenance?.files?.[name],
        )
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}
export async function writeSourceArchive(stateDir, provenance, files) {
  if (!validRevision(provenance?.revision))
    throw Error('Invalid airport archive revision');
  for (const name of AIRPORT_SOURCE_FILES) {
    if (
      typeof files?.[name] !== 'string' ||
      !verify(Buffer.from(files[name]), provenance.files?.[name])
    )
      throw Error('Incomplete or corrupt airport archive: ' + name);
  }
  const root = join(stateDir, 'raw');
  const target = join(root, provenance.revision);
  if (await hasSourceArchive(target, provenance)) return;
  await mkdir(root, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(join(root, '.incoming-'));
  try {
    for (const name of AIRPORT_SOURCE_FILES)
      await writeFile(join(temporary, name), files[name], {
        mode: 0o600,
        flag: 'wx',
        flush: true,
      });
    try {
      await rename(temporary, target);
    } catch (error) {
      // A peer may already have published the same immutable version.
      if (await hasSourceArchive(target, provenance)) return;
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(error.code))
        throw error;
      const quarantine = join(
        root,
        `.invalid-${provenance.revision}-${randomUUID()}`,
      );
      try {
        await rename(target, quarantine);
      } catch (moveError) {
        if (moveError.code !== 'ENOENT') throw moveError;
      }
      try {
        await rename(temporary, target);
      } catch (publishError) {
        if (!(await hasSourceArchive(target, provenance))) throw publishError;
      }
    }
  } finally {
    // Only the directory returned by mkdtemp is removed; published versions are immutable.
    await rm(temporary, { recursive: true, force: true });
  }
}
export async function readArchivedSource(
  stateDir,
  provenance,
  name,
  bundledProvenance = null,
) {
  if (
    !AIRPORT_SOURCE_FILES.includes(name) ||
    !validRevision(provenance?.revision)
  )
    throw Error('Invalid airport source file');
  try {
    const body = await readFile(
      join(stateDir, 'raw', provenance.revision, name),
    );
    if (verify(body, provenance.files?.[name])) return body;
  } catch {
    /* A matching project bundle is the offline fallback. */
  }
  if (bundledProvenance?.revision === provenance.revision) {
    const body = await readFile(filePath(BUNDLED_SOURCE_DIR, name));
    if (verify(body, bundledProvenance.files?.[name])) return body;
  }
  throw Error('Airport source archive unavailable');
}
