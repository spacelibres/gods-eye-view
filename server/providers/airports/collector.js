import {
  readFile,
  writeFile,
  mkdir,
  rename,
  unlink,
  open,
  stat,
  chmod,
} from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import {
  parseAirportCsv,
  validateAirportReferences,
  validateSnapshot,
} from './model.js';
export const DAY = 86400000;
const bundledUrl = new URL(
  '../../data/airports/snapshot.json',
  import.meta.url,
);
function abortable(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(signal.reason || Error('Airport request aborted'));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}
export async function readBoundedResponse(
  response,
  { maxBytes = 20000000, signal } = {},
) {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    void response.body?.cancel().catch(() => {});
    throw Error('Response too large');
  }
  if (!response.body) throw Error('Empty response body');
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw Error('Response too large');
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch (e) {
    void reader.cancel().catch(() => {});
    throw e;
  } finally {
    reader.releaseLock();
  }
}
export async function downloadSnapshot({
  fetchImpl = fetch,
  now = Date.now,
  signal,
  revision,
} = {}) {
  const get = async (url, maxBytes) => {
    const response = await abortable(
      fetchImpl(url, {
        signal,
        headers: {
          'User-Agent': 'GodsEyeView-airports/1',
          Accept: 'application/json,text/csv',
        },
      }),
      signal,
    );
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      const error = Error('OurAirports HTTP ' + response.status);
      const retry = response.headers.get('retry-after');
      if (retry) {
        const seconds = Number(retry);
        error.retryAt = Number.isFinite(seconds)
          ? now() + Math.max(0, seconds) * 1000
          : Date.parse(retry);
      }
      throw error;
    }
    return readBoundedResponse(response, { maxBytes, signal });
  };
  if (!revision) {
    const latest = JSON.parse(
      await get(
        'https://api.github.com/repos/davidmegginson/ourairports-data/commits/main',
        1000000,
      ),
    );
    revision = latest.sha;
  }
  if (!/^[a-f0-9]{40}$/.test(revision))
    throw Error('Invalid upstream revision');
  const sourceUrl =
    'https://github.com/davidmegginson/ourairports-data/tree/' + revision;
  const files = {};
  for (const name of ['airports', 'countries', 'regions'])
    files[name] = await get(
      'https://raw.githubusercontent.com/davidmegginson/ourairports-data/' +
        revision +
        '/' +
        name +
        '.csv',
      name === 'airports' ? 20000000 : 5000000,
    );
  const snapshot = validateSnapshot(
    {
      schemaVersion: 1,
      revision,
      updatedAt: new Date(now()).toISOString(),
      source: 'OurAirports',
      sourceUrl,
      records: parseAirportCsv(files.airports, files.countries, files.regions),
    },
    { production: true },
  );
  validateAirportReferences(files.countries, files.regions, snapshot.records);
  return {
    snapshot,
    provenance: {
      schemaVersion: 1,
      source: 'OurAirports',
      license: 'Public domain',
      revision,
      retrievedAt: snapshot.updatedAt,
      sourceUrl,
      records: snapshot.records.length,
      snapshotSha256: createHash('sha256')
        .update(JSON.stringify(snapshot))
        .digest('hex'),
      files: Object.fromEntries(
        Object.entries(files).map(([name, body]) => [
          name + '.csv',
          {
            bytes: Buffer.byteLength(body),
            sha256: createHash('sha256').update(body).digest('hex'),
          },
        ]),
      ),
    },
  };
}
async function atomic(path, value, renameImpl = rename) {
  const tmp = path + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(tmp, JSON.stringify(value), {
      mode: 0o600,
      flag: 'wx',
      flush: true,
    });
    await renameImpl(tmp, path);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}
async function json(path, max = 100000000) {
  const info = await stat(path);
  if (info.size > max) throw Error('Persistent airport file too large');
  return JSON.parse(await readFile(path, 'utf8'));
}
export function createAirportCollector(options = {}) {
  const stateDir =
    options.stateDir ||
    process.env.GEV_AIRPORTS_STATE_DIR ||
    join(homedir(), '.gods-eye-view', 'airports');
  const now = options.now || Date.now;
  const production = options.production !== false;
  const setTimer = options.setTimeoutImpl || setTimeout,
    clearTimer = options.clearTimeoutImpl || clearTimeout;
  let snapshot,
    state,
    timer,
    inflight,
    closed = false,
    controller,
    peerRead,
    peerVersion;
  const statePath = join(stateDir, 'state.json'),
    snapshotPath = join(stateDir, 'directory.json'),
    lockPath = join(stateDir, 'refresh.lock');
  const readState = async () => {
    try {
      const s = await json(statePath, 10000);
      if (
        s.schemaVersion !== 1 ||
        !Number.isFinite(s.nextCheckAt) ||
        s.nextCheckAt < 0
      )
        throw Error('Invalid state');
      return s;
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      return { schemaVersion: 1, nextCheckAt: now() + DAY, corrupt: true };
    }
  };
  const loadPeer = async () => {
    if (peerRead) return peerRead;
    peerRead = (async () => {
      try {
        const info = await stat(snapshotPath);
        const version = `${info.ino}:${info.mtimeMs}:${info.size}`;
        if (version === peerVersion) return;
        const envelope = await json(snapshotPath);
        const candidate = validateSnapshot(envelope.snapshot, { production });
        if (
          envelope.schemaVersion !== 1 ||
          envelope.provenance?.revision !== candidate.revision ||
          envelope.provenance?.snapshotSha256 !==
            createHash('sha256').update(JSON.stringify(candidate)).digest('hex')
        )
          throw Error('Invalid airport envelope');
        snapshot = candidate;
        peerVersion = version;
      } catch {
        /* Keep the validated in-memory/bundled snapshot. */
      }
    })().finally(() => {
      peerRead = null;
    });
    return peerRead;
  };
  const schedule = () => {
    if (closed) return;
    clearTimer(timer);
    timer = setTimer(
      () => {
        void refresh();
      },
      Math.max(
        1000,
        Math.min(DAY, (state?.nextCheckAt || now() + DAY) - now()),
      ),
    );
    timer?.unref?.();
  };
  const ready = (async () => {
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    await chmod(stateDir, 0o700);
    snapshot = validateSnapshot(
      options.bundledSnapshot || (await json(bundledUrl)),
      { production },
    );
    await loadPeer();
    state = await readState();
    if (!state) {
      state = {
        schemaVersion: 1,
        nextCheckAt: Math.max(now(), Date.parse(snapshot.updatedAt) + DAY),
      }; /* Persist only while holding refresh lock, so workers cannot overwrite a reservation. */
    }
    schedule();
  })();
  async function refresh() {
    await ready;
    if (closed) return;
    if (inflight) return inflight;
    inflight = (async () => {
      let lock;
      try {
        try {
          lock = await open(lockPath, 'wx', 0o600);
          await lock.writeFile(JSON.stringify({ until: now() + 120000 }));
          await lock.sync();
        } catch (e) {
          if (e.code !== 'EEXIST') throw e;
          try {
            const info = await stat(lockPath);
            if (now() - info.mtimeMs > 180000) await unlink(lockPath);
          } catch {}
          await loadPeer();
          return;
        }
        const disk = await readState();
        if (disk) state = disk;
        if (state.nextCheckAt > now()) {
          if (state.corrupt)
            await atomic(
              statePath,
              {
                schemaVersion: 1,
                nextCheckAt: state.nextCheckAt,
              },
              options.renameImpl,
            );
          await loadPeer();
          return;
        }
        state = { schemaVersion: 1, nextCheckAt: now() + DAY };
        await atomic(statePath, state, options.renameImpl);
        controller = new AbortController();
        const timeout = setTimer(
          () => controller.abort(Error('Airport download timeout')),
          60000,
        );
        timeout?.unref?.();
        try {
          const load = options.loadSnapshot || downloadSnapshot;
          const result = await abortable(
            load({
              fetchImpl: options.fetchImpl,
              now,
              signal: controller.signal,
            }),
            controller.signal,
          );
          const next = validateSnapshot(result.snapshot || result, {
            production,
          });
          if (closed) return;
          const provenance = result.provenance || {
            schemaVersion: 1,
            source: next.source,
            sourceUrl: next.sourceUrl,
            revision: next.revision,
            retrievedAt: next.updatedAt,
            records: next.records.length,
          };
          const checksum = createHash('sha256')
            .update(JSON.stringify(next))
            .digest('hex');
          if (
            provenance.revision !== next.revision ||
            (provenance.snapshotSha256 &&
              provenance.snapshotSha256 !== checksum)
          )
            throw Error('Airport provenance mismatch');
          await atomic(
            snapshotPath,
            {
              schemaVersion: 1,
              snapshot: next,
              provenance: { ...provenance, snapshotSha256: checksum },
            },
            options.renameImpl,
          );
          snapshot = next;
        } catch (e) {
          if (Number.isFinite(e.retryAt) && e.retryAt > state.nextCheckAt) {
            state.nextCheckAt = e.retryAt;
            await atomic(statePath, state, options.renameImpl);
          }
          options.onError?.(e);
        } finally {
          clearTimer(timeout);
          controller = null;
        }
      } catch (e) {
        options.onError?.(e);
      } finally {
        if (lock) {
          await lock.close();
          await unlink(lockPath).catch(() => {});
        }
        schedule();
      }
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  }
  return {
    ready,
    refresh,
    getSnapshot: () => snapshot,
    async readSnapshot() {
      await ready;
      await loadPeer();
      return snapshot;
    },
    getState: () => ({ ...state }),
    async close() {
      closed = true;
      clearTimer(timer);
      controller?.abort();
      await inflight;
    },
  };
}
