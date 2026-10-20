import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readResponseTextCapped } from '../common/http.js';
import { requiredFiniteQueryNumber } from '../common/query.js';
import { getOpenSkyToken, invalidateOpenSkyToken } from './opensky-auth.js';
import {
  OPENSKY_DAY_MS,
  OPENSKY_REFRESH_MS,
  openSkyStateDirectory,
  sharedOpenSkyStatesQuota,
} from './opensky-quota.js';
export { getOpenSkyToken } from './opensky-auth.js';

const MAX_BYTES = 8 * 1024 * 1024;

// Kept as the established coordinate validator used by GNSS. Browser flight
// requests no longer start regional ADS-B fallbacks or any upstream request.
export function adsbLolFallbackAnchor(req) {
  const incoming = new URL(req?.url || '', 'http://localhost');
  const latitude = requiredFiniteQueryNumber(incoming.searchParams, 'lat');
  const longitude = requiredFiniteQueryNumber(incoming.searchParams, 'lon');
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)
    return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)
    return null;
  return { latitude, longitude };
}

function admit(body, at) {
  const value = JSON.parse(body);
  const observedAt = typeof value.time === 'number' ? value.time * 1000 : NaN;
  if (
    !Number.isFinite(observedAt) ||
    observedAt <= 0 ||
    observedAt > at + 60000 ||
    at - observedAt >= OPENSKY_DAY_MS ||
    !Array.isArray(value.states) ||
    value.states.some(
      (row) =>
        !Array.isArray(row) ||
        typeof row[0] !== 'string' ||
        !/^[a-f0-9]{6}$/i.test(row[0]),
    )
  )
    throw new Error('Invalid OpenSky snapshot');
  return observedAt;
}

/** The VPS owns collection; every browser reads the same dated global snapshot. */
export function openSkyProxy({
  directory = openSkyStateDirectory(),
  quota = sharedOpenSkyStatesQuota,
  now = () => Date.now(),
  tokenProvider = getOpenSkyToken,
  invalidateToken = invalidateOpenSkyToken,
  authMode = () => process.env.OPENSKY_AUTH_MODE || 'oauth',
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const file = resolve(directory, 'states-snapshot.json');
  let cached = null,
    diskVersion = null,
    nextAt = 0,
    timer = null,
    running = null,
    controller = null;
  let stopped = true,
    generation = 0,
    reason = 'collection_pending';
  const mode = () =>
    String(typeof authMode === 'function' ? authMode() : authMode)
      .trim()
      .toLowerCase();
  function restore() {
    try {
      if (!existsSync(file)) return;
      const info = statSync(file),
        version = `${info.ino}:${info.mtimeMs}:${info.ctimeMs}:${info.size}`;
      if (version === diskVersion || info.size > MAX_BYTES * 2 + 4096) return;
      diskVersion = version;
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      const observedAt = admit(saved.body, now());
      if (
        !Number.isFinite(saved.publishedAt) ||
        saved.publishedAt > now() ||
        !['oauth', 'anon'].includes(saved.authMode) ||
        (cached && observedAt < cached.observedAt)
      )
        return;
      cached = { ...saved, observedAt };
      reason = saved.authMode === 'anon' ? 'anonymous_ok' : 'oauth_ok';
      nextAt = Math.max(nextAt, saved.publishedAt + OPENSKY_REFRESH_MS);
    } catch {
      /* Corrupt snapshots are unavailable; never reset quota to repair them. */
    }
  }
  function schedule() {
    if (stopped) return;
    clearTimer(timer);
    const delay = Math.max(1000, nextAt - now(), quota.waitMs());
    nextAt = now() + delay;
    timer = setTimer(
      () => {
        void refresh();
      },
      Math.min(delay, 2147483647),
    );
    timer?.unref?.();
  }
  function refresh() {
    if (stopped || running) return running;
    restore();
    const wait = Math.max(nextAt - now(), quota.waitMs());
    if (wait > 0) {
      nextAt = now() + wait;
      schedule();
      return Promise.resolve();
    }
    const epoch = generation;
    controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(12000),
    ]);
    nextAt = now() + OPENSKY_REFRESH_MS;
    running = Promise.resolve()
      .then(async () => {
        try {
          const requested = mode(),
            anonymous = requested === 'anon';
          const token = anonymous
            ? null
            : ['oauth', 'auto'].includes(requested)
              ? await tokenProvider()
              : null;
          signal.throwIfAborted();
          if (!anonymous && !token) {
            reason = 'oauth_invalid_or_missing';
            return;
          }
          const response = await quota.fetch('/api/states/all?extended=1', {
            signal,
            headers: {
              Accept: 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          });
          signal.throwIfAborted();
          if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
              invalidateToken();
              reason = 'oauth_invalid_credentials';
            } else
              reason =
                response.status === 429
                  ? 'rate_limited'
                  : 'upstream_unavailable';
            void response.body?.cancel().catch(() => {});
            return;
          }
          const body = await readResponseTextCapped(
            response,
            MAX_BYTES,
            signal,
          );
          signal.throwIfAborted();
          if (stopped || epoch !== generation) return;
          const observedAt = admit(body, now());
          if (cached && observedAt < cached.observedAt)
            throw new Error('Retrograde OpenSky snapshot');
          const entry = {
            body,
            observedAt,
            publishedAt: now(),
            authMode: anonymous ? 'anon' : 'oauth',
          };
          mkdirSync(directory, { recursive: true, mode: 0o700 });
          const temporary = file + '.' + randomUUID() + '.tmp';
          try {
            writeFileSync(temporary, JSON.stringify(entry), {
              mode: 0o600,
              flush: true,
            });
            renameSync(temporary, file);
          } finally {
            if (existsSync(temporary)) unlinkSync(temporary);
          }
          cached = entry;
          reason = anonymous ? 'anonymous_ok' : 'oauth_ok';
        } catch {
          if (!stopped && epoch === generation)
            reason = 'collection_unavailable';
        }
      })
      .finally(() => {
        if (epoch !== generation) return;
        running = null;
        controller = null;
        schedule();
      });
    return running;
  }
  function close() {
    stopped = true;
    generation++;
    clearTimer(timer);
    controller?.abort();
  }
  function install(server) {
    if (stopped) {
      stopped = false;
      generation++;
      running = null;
      restore();
      void refresh();
      server.httpServer?.once?.('close', close);
    }
    server.middlewares.use('/api/flights', (req, res, next) => {
      if (new URL(req.url || '/', 'http://localhost').pathname !== '/')
        return next();
      if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        res.end();
        return;
      }
      restore();
      const at = now(),
        delay = running ? 1000 : Math.max(1000, nextAt - at, quota.waitMs());
      const available = cached && at - cached.observedAt < OPENSKY_DAY_MS;
      const age = available ? Math.max(0, at - cached.observedAt) : null;
      const stale =
        available &&
        (age > 120000 ||
          !['oauth_ok', 'anonymous_ok', 'collection_pending'].includes(reason));
      const cache = available ? (stale ? 'STALE' : 'HIT') : 'NONE';
      const usedMode = available ? cached.authMode : 'none';
      const authReason =
        available &&
        ['collection_pending', 'oauth_ok', 'anonymous_ok'].includes(reason)
          ? usedMode === 'oauth'
            ? 'oauth_ok'
            : 'anonymous_ok'
          : reason;
      res.writeHead(available ? 200 : 503, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Feed-Source': 'OpenSky Network',
        'X-Flight-Coverage': 'worldwide upstream snapshot',
        'X-Feed-Cache': cache,
        'X-OpenSky-Cache': cache,
        'X-OpenSky-Auth': usedMode,
        'X-OpenSky-Auth-Mode-Used': usedMode,
        'X-OpenSky-Auth-Mode-Requested': mode(),
        'X-OpenSky-Auth-Reason': authReason,
        'X-Feed-Next-Refresh-Ms': String(Math.ceil(delay)),
        ...(age != null
          ? {
              'X-Feed-Age-Ms': String(Math.ceil(age)),
              'X-OpenSky-Stale-Seconds': String(Math.floor(age / 1000)),
            }
          : {}),
        ...(!available
          ? {
              'Retry-After': String(Math.ceil(delay / 1000)),
              'X-OpenSky-Retry-After-Seconds': String(Math.ceil(delay / 1000)),
            }
          : {}),
      });
      res.end(
        req.method === 'HEAD'
          ? undefined
          : available
            ? cached.body
            : JSON.stringify({ error: 'OpenSky data collection pending' }),
      );
    });
  }
  return {
    name: 'opensky-proxy',
    configureServer: install,
    configurePreviewServer: install,
    closeBundle: close,
    ready: () => running || Promise.resolve(),
  };
}
