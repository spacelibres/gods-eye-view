import {
  readFileSync,
  statSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  openSync,
  closeSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getOpenSkyToken } from './opensky-auth.js';
import {
  openSkyStateDirectory,
  sharedOpenSkyTracksQuota,
} from './opensky-quota.js';
import { readCappedResponseText } from '../common/http.js';

const TRACK_CACHE_MS = 60000;
const TRACK_CACHE_MAX = 200;
const RESPONSE_CAP_BYTES = 5 * 1024 * 1024;
// Requests survive a browser disconnect; one reader cannot cancel shared work.
const openSkyInFlight = new Map();

function retryWait(headers, now) {
  const vendor = Number(headers.get('x-rate-limit-retry-after-seconds'));
  const value = headers.get('retry-after');
  const seconds = value === null ? NaN : Number(value);
  const date =
    value === null || Number.isFinite(seconds) ? NaN : Date.parse(value);
  return Math.max(
    0,
    Number.isFinite(vendor) ? vendor * 1000 : 0,
    Number.isFinite(seconds) ? seconds * 1000 : 0,
    Number.isFinite(date) ? date - now : 0,
  );
}

/** Shared historical track proxies; OpenSky uses its independent durable quota. */
export function trackBackfillProxies({
  quota = sharedOpenSkyTracksQuota,
  directory = openSkyStateDirectory(),
  now = Date.now,
  tokenProvider = getOpenSkyToken,
  fetchImpl = (...args) => fetch(...args),
} = {}) {
  const cachePath = join(directory, 'tracks-cache.json');
  const militaryCache = new Map();
  const militaryInFlight = new Map();

  function readCache() {
    try {
      if (statSync(cachePath).size > RESPONSE_CAP_BYTES)
        throw new Error('Track cache exceeds byte cap');
      const saved = JSON.parse(readFileSync(cachePath, 'utf8'));
      if (
        !Array.isArray(saved.entries) ||
        saved.entries.length > TRACK_CACHE_MAX ||
        !saved.entries.every((record) => {
          if (!Array.isArray(record) || record.length !== 2) return false;
          const [key, entry] = record;
          return (
            /^[0-9a-f]{6}$/.test(key) &&
            entry &&
            Number.isFinite(entry.at) &&
            Number.isFinite(entry.until) &&
            Number.isInteger(entry.status) &&
            entry.status >= 200 &&
            entry.status <= 599 &&
            typeof entry.body === 'string' &&
            (entry.pending === undefined || typeof entry.pending === 'string')
          );
        }) ||
        new Set(saved.entries.map(([key]) => key)).size !== saved.entries.length
      ) {
        throw new Error('Invalid track cache');
      }
      return new Map(saved.entries);
    } catch (error) {
      if (error.code === 'ENOENT') return new Map();
      throw error;
    }
  }

  function writeCache(cache, protectedKey) {
    let entries = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
    const sizes = new Map(
      entries.map(([key, entry]) => [
        key,
        Buffer.byteLength(JSON.stringify([key, entry])),
      ]),
    );
    let bytes =
      Buffer.byteLength('{"entries":[]}') +
      [...sizes.values()].reduce((sum, size) => sum + size, 0) +
      Math.max(0, entries.length - 1);
    while (entries.length > TRACK_CACHE_MAX || bytes > RESPONSE_CAP_BYTES) {
      // Active reservations survive cache pressure until completed or expired.
      const index = entries.findIndex(
        ([key, entry]) =>
          key !== protectedKey && (!entry.pending || entry.until <= now()),
      );
      if (index < 0) throw new Error('Track cache has no reservation capacity');
      const [[key]] = entries.splice(index, 1);
      bytes -= sizes.get(key) + (entries.length ? 1 : 0);
    }
    const payload = JSON.stringify({ entries });
    mkdirSync(directory, { recursive: true });
    const temporary = `${cachePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, payload, { mode: 0o600, flush: true });
      renameSync(temporary, cachePath);
    } finally {
      try {
        unlinkSync(temporary);
      } catch {
        /* renamed or write failed */
      }
    }
  }

  async function transaction(action) {
    mkdirSync(directory, { recursive: true });
    const lock = `${cachePath}.lock`;
    let fd;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        fd = openSync(lock, 'wx', 0o600);
        break;
      } catch (error) {
        if (error.code !== 'EEXIST' || attempt === 19) throw error;
        await new Promise((done) => setTimeout(done, 25));
      }
    }
    try {
      // No await or network work can hold this short cross-process lock.
      return action(readCache());
    } finally {
      closeSync(fd);
      unlinkSync(lock);
    }
  }

  function unavailable() {
    return {
      at: now(),
      until: now() + 1000,
      status: 503,
      body: JSON.stringify({ error: 'Track cache reservation unavailable' }),
    };
  }

  function send(res, entry) {
    res.statusCode = entry.status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (entry.until > now() && entry.status >= 400) {
      res.setHeader(
        'Retry-After',
        String(Math.ceil((entry.until - now()) / 1000)),
      );
    }
    res.end(entry.body);
  }

  async function readUpstream(upstream, durable = false) {
    if (!upstream.ok) {
      // The public error contains only the status. Do not let an endless error
      // body (or stalled cancellation) hold shared readers past a known retry.
      try {
        upstream.body?.cancel().catch(() => {});
      } catch {
        /* A locked or already cancelled body does not change the HTTP result. */
      }
      return {
        at: now(),
        until:
          now() +
          Math.max(
            TRACK_CACHE_MS,
            durable ? retryWait(upstream.headers, now()) : 0,
            durable && upstream.status === 429
              ? Number(quota.waitMs()) || 0
              : 0,
          ),
        status: upstream.status,
        body: JSON.stringify({ error: `Track source HTTP ${upstream.status}` }),
      };
    }
    const { tooLarge, text } = await readCappedResponseText(
      upstream,
      RESPONSE_CAP_BYTES,
    );
    const entry = {
      at: now(),
      until: now() + TRACK_CACHE_MS,
      status: tooLarge ? 502 : upstream.status,
      body: tooLarge
        ? JSON.stringify({ error: 'Upstream track response too large' })
        : text,
    };
    if (
      durable &&
      Buffer.byteLength(JSON.stringify({ entries: [['abcdef', entry]] })) >
        RESPONSE_CAP_BYTES
    ) {
      entry.status = 502;
      entry.body = JSON.stringify({
        error: 'Upstream track response too large',
      });
    }
    return entry;
  }

  async function openSkyTrack(icao24) {
    const key = `${resolve(directory)}:${icao24}`;
    if (openSkyInFlight.has(key)) return openSkyInFlight.get(key);
    const pending = (async () => {
      const reservation = randomUUID();
      try {
        const cached = await transaction((cache) => {
          const current = cache.get(icao24);
          if (current && now() < current.until) return current;
          cache.set(icao24, {
            at: now(),
            until: now() + TRACK_CACHE_MS,
            status: 503,
            pending: reservation,
            body: JSON.stringify({ error: 'Track refresh in progress' }),
          });
          writeCache(cache, icao24);
          return null;
        });
        if (cached) return cached;
      } catch {
        // No durable reservation means no authentication or upstream attempt.
        return unavailable();
      }
      let entry;
      try {
        // Authentication failure must not silently spend anonymous allowance.
        const token = await tokenProvider();
        if (!token && process.env.OPENSKY_AUTH_MODE !== 'anon') {
          const error = new Error('OpenSky OAuth unavailable');
          error.status = 503;
          throw error;
        }
        const upstream = await quota.fetch(
          `https://opensky-network.org/api/tracks/all?icao24=${icao24}&time=0`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            signal: AbortSignal.timeout(12000),
          },
        );
        entry = await readUpstream(upstream, true);
      } catch (error) {
        const wait = Number(quota.waitMs()) || 0;
        entry = {
          at: now(),
          until: now() + Math.max(TRACK_CACHE_MS, wait),
          status: error.status === 503 ? 503 : 502,
          body: JSON.stringify({
            error:
              error.status === 503
                ? 'OpenSky OAuth unavailable'
                : 'OpenSky track fetch failed',
          }),
        };
      }
      // A disk failure must not turn a successful upstream body into another download.
      memoryCache.delete(icao24);
      memoryCache.set(icao24, entry);
      while (
        memoryCache.size > TRACK_CACHE_MAX ||
        Buffer.byteLength(JSON.stringify([...memoryCache])) > RESPONSE_CAP_BYTES
      ) {
        memoryCache.delete(memoryCache.keys().next().value);
      }
      try {
        await transaction((cache) => {
          if (cache.get(icao24)?.pending !== reservation) return;
          cache.set(icao24, entry);
          writeCache(cache, icao24);
        });
      } catch {
        /* memory cache remains available */
      }
      return entry;
    })();
    openSkyInFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      openSkyInFlight.delete(key);
    }
  }
  const memoryCache = new Map();

  async function militaryTrack(hex) {
    const cached = militaryCache.get(hex);
    if (cached && now() - cached.at < TRACK_CACHE_MS) return cached;
    if (militaryInFlight.has(hex)) return militaryInFlight.get(hex);
    const pending = (async () => {
      const upstream = await fetchImpl(
        `https://adsb.lol/data/traces/${hex.slice(-2)}/trace_full_${hex}.json`,
        { signal: AbortSignal.timeout(12000) },
      );
      const entry = await readUpstream(upstream);
      militaryCache.set(hex, entry);
      if (militaryCache.size > TRACK_CACHE_MAX)
        militaryCache.delete(militaryCache.keys().next().value);
      return entry;
    })();
    militaryInFlight.set(hex, pending);
    try {
      return await pending;
    } finally {
      militaryInFlight.delete(hex);
    }
  }

  function install(middlewares) {
    middlewares.use('/api/flights/track', async (req, res) => {
      const icao24 = String(
        new URL(req.url || '', 'http://localhost').searchParams.get('icao24') ||
          '',
      )
        .trim()
        .toLowerCase();
      if (!/^[0-9a-f]{6}$/.test(icao24)) {
        send(res, {
          status: 400,
          body: JSON.stringify({ error: 'icao24 must be a 6-char hex string' }),
        });
        return;
      }
      const cached = memoryCache.get(icao24);
      send(
        res,
        cached && now() < cached.until ? cached : await openSkyTrack(icao24),
      );
    });
    middlewares.use('/api/military/track', async (req, res) => {
      try {
        const hex = String(
          new URL(req.url || '', 'http://localhost').searchParams.get('hex') ||
            '',
        )
          .trim()
          .toLowerCase();
        if (!/^[0-9a-f~]{6,7}$/.test(hex)) {
          send(res, {
            status: 400,
            body: JSON.stringify({
              error: 'hex must be a 6-7 char hex string',
            }),
          });
          return;
        }
        send(res, await militaryTrack(hex));
      } catch {
        send(res, {
          status: 502,
          body: JSON.stringify({ error: 'adsb.lol trace fetch failed' }),
        });
      }
    });
  }
  return {
    name: 'track-backfill-proxies',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}
