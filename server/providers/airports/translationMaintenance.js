import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { translationWorklist } from './localization.js';
import { acquireFileLock } from './fileLock.js';

/** Persist a compact, resumable translation worklist during source maintenance. */
export async function writePendingTranslations(snapshot, catalog, directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const state = {
    schemaVersion: 1,
    sourceRevision: snapshot.revision,
    catalogRevision:
      catalog.translationRevision ||
      createHash('sha256')
        .update(JSON.stringify(catalog.entries))
        .digest('hex'),
  };
  const serialized = JSON.stringify(state);
  const marker = join(directory, 'pending-state.json');
  try {
    if ((await readFile(marker, 'utf8')) === serialized) {
      await stat(join(directory, 'pending.ndjson'));
      return false;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const lockPath = join(directory, 'pending.lock');
  let release;
  try {
    release = await acquireFileLock(lockPath);
  } catch (error) {
    if (!error.message.startsWith('File locked:')) throw error;
    return false;
  }
  const token = randomUUID();
  const temporary = join(directory, `.pending-${token}.tmp`);
  const stateTemporary = join(directory, `.pending-state-${token}.tmp`);
  let file;
  try {
    try {
      if ((await readFile(marker, 'utf8')) === serialized) {
        await stat(join(directory, 'pending.ndjson'));
        return false;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    file = await open(temporary, 'wx', 0o600);
    let buffer = serialized + '\n';
    let previous, previousKey;
    for (const entry of translationWorklist(snapshot, catalog)) {
      const { locale, ...item } = entry;
      const itemKey = JSON.stringify([
        item.kind,
        item.id,
        item.field,
        item.fingerprint,
      ]);
      if (previousKey === itemKey) previous.locales.push(locale);
      else {
        if (previous) buffer += JSON.stringify(previous) + '\n';
        previous = { ...item, locales: [locale] };
        previousKey = itemKey;
      }
      if (buffer.length > 262144) {
        await file.writeFile(buffer);
        buffer = '';
      }
    }
    if (previous) buffer += JSON.stringify(previous) + '\n';
    await file.writeFile(buffer);
    await file.sync();
    await file.close();
    file = null;
    await rename(temporary, join(directory, 'pending.ndjson'));
    const checkpoint = await open(stateTemporary, 'wx', 0o600);
    try {
      await checkpoint.writeFile(serialized);
      await checkpoint.sync();
    } finally {
      await checkpoint.close();
    }
    await rename(stateTemporary, marker);
    return true;
  } finally {
    await file?.close();
    await unlink(temporary).catch(() => {});
    await unlink(stateTemporary).catch(() => {});
    await release();
  }
}
