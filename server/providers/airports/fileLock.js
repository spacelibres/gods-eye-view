import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import {
  closeSync,
  fsyncSync,
  linkSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
function readOwner(path) {
  try {
    const owner = JSON.parse(readFileSync(path, 'utf8'));
    if (
      !owner ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid <= 0 ||
      typeof owner.hostname !== 'string' ||
      typeof owner.token !== 'string' ||
      !/^[0-9a-f-]{36}$/.test(owner.token)
    )
      throw Error('Invalid lock owner');
    return owner;
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw Error(`File locked: unreadable owner at ${path}`);
  }
}
function isAlive(owner) {
  if (owner.hostname !== hostname()) return true;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}
function publish(path, owner) {
  // A hard link publishes fully written owner metadata atomically; a killed writer
  // cannot leave an empty owner file that another process might mistake as dead.
  const temporary = `${path}.${owner.token}.owner`;
  const handle = openSync(temporary, 'wx');
  try {
    writeFileSync(handle, JSON.stringify(owner));
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  try {
    linkSync(temporary, path);
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  } finally {
    unlinkSync(temporary);
  }
}
function acquire(path, depth = 0) {
  if (depth > 64)
    throw Error(`File locked: recovery chain too deep at ${path}`);
  const owner = { pid: process.pid, hostname: hostname(), token: randomUUID() };
  if (!publish(path, owner)) {
    const previous = readOwner(path);
    if (!previous) return acquire(path, depth + 1);
    if (isAlive(previous))
      throw Error(`File locked: live owner ${previous.pid} at ${path}`);
    // Recovery is serialized by the abandoned owner's unique token. If a recovery
    // process is itself killed, recover its token in turn instead of age-deleting
    // a lock that could belong to a live replacement writer.
    const releaseRecovery = acquire(
      `${path}.recovery.${previous.token}`,
      depth + 1,
    );
    try {
      const current = readOwner(path);
      if (current?.token === previous.token) unlinkSync(path);
      if (!publish(path, owner))
        throw Error(`File locked: owner changed at ${path}`);
    } finally {
      releaseRecovery();
    }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = readOwner(path);
    if (current?.token === owner.token) unlinkSync(path);
  };
}
export async function acquireFileLock(path) {
  const release = acquire(path);
  return async () => release();
}
