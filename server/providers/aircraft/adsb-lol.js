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
import {
  ADSB_REFRESH_MS,
  ADSB_DAY_MS,
  adsbStateDirectory,
  sharedAdsbQuota,
} from './adsb-quota.js';

const MAX_BYTES = 8 * 1024 * 1024;

function admit(body, at) {
  const value = JSON.parse(body);
  const observedAt = Number(value.now) * (Number(value.now) > 1e12 ? 1 : 1000);
  if (
    !Array.isArray(value.ac) ||
    !Number.isFinite(observedAt) ||
    observedAt <= 0 ||
    observedAt > at + 60_000 ||
    at - observedAt >= ADSB_DAY_MS ||
    value.ac.some(
      (row) => !row || typeof row.hex !== 'string' || !row.hex.trim(),
    )
  )
    throw new Error('Invalid military snapshot');
  return observedAt;
}

/** VPS-owned collector. HTTP readers can never start or accelerate a vendor request. */
export function adsbLolProxy({
  directory = adsbStateDirectory(),
  quota = sharedAdsbQuota,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const file = resolve(directory, 'military.json');
  let cached = null;
  let diskVersion = null;
  let nextAt = 0;
  let timer = null;
  let running = null;
  let controller = null;
  let stopped = true;
  let failure = null;

  function restore() {
    try {
      if (!existsSync(file)) return;
      const info = statSync(file);
      const version = `${info.ino}:${info.mtimeMs}:${info.ctimeMs}:${info.size}`;
      if (version === diskVersion || info.size > MAX_BYTES * 2 + 4096) return;
      diskVersion = version;
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      const observedAt = admit(saved.body, now());
      if (!Number.isFinite(saved.publishedAt) || saved.publishedAt > now())
        return;
      cached = { ...saved, observedAt };
      nextAt = Math.max(nextAt, saved.publishedAt + ADSB_REFRESH_MS);
      failure = null;
    } catch {
      /* A broken snapshot is unavailable; never reset the quota ledger. */
    }
  }
  function schedule() {
    if (stopped) return;
    clearTimer(timer);
    const delay = Math.max(1000, nextAt - now(), quota.waitMs('military'));
    nextAt = now() + delay;
    timer = setTimer(
      () => {
        void refresh();
      },
      Math.min(delay, 2_147_483_647),
    );
    timer?.unref?.();
  }
  function refresh() {
    if (stopped || running) return running;
    restore();
    const wait = Math.max(nextAt - now(), quota.waitMs('military'));
    if (wait > 0) {
      nextAt = now() + wait;
      schedule();
      return Promise.resolve();
    }
    controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(12_000),
    ]);
    nextAt = now() + ADSB_REFRESH_MS;
    running = (async () => {
      try {
        const response = await quota.fetch(
          '/v2/mil',
          {
            signal,
            headers: { 'User-Agent': 'gods-eye-view-adsblol-proxy/1.0' },
          },
          'military',
        );
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error('Military upstream HTTP ' + response.status);
        }
        const body = await readResponseTextCapped(response, MAX_BYTES, signal);
        signal.throwIfAborted();
        if (stopped) return;
        const observedAt = admit(body, now());
        const entry = { body, observedAt, publishedAt: now() };
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
        failure = null;
      } catch (error) {
        if (!stopped) failure = error.message;
      } finally {
        running = null;
        controller = null;
        schedule();
      }
    })();
    return running;
  }
  function close() {
    stopped = true;
    clearTimer(timer);
    controller?.abort();
  }
  function install(server) {
    if (stopped) {
      stopped = false;
      restore();
      void refresh();
      server.httpServer?.once?.('close', close);
    }
    server.middlewares.use('/api/military', (req, res, next) => {
      if (new URL(req.url || '/', 'http://localhost').pathname !== '/')
        return next();
      if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        res.end();
        return;
      }
      // A peer worker may have won the shared collection reservation. Only
      // reload atomically replaced snapshots; this never starts a fetch.
      restore();
      const at = now();
      // A read while collection is in flight should see its result shortly,
      // not wait another full collection interval for the previous snapshot.
      const delay = running
        ? 1000
        : Math.max(1000, nextAt - at, quota.waitMs('military'));
      const available = cached && at - cached.observedAt < ADSB_DAY_MS;
      const age = available ? Math.max(0, at - cached.observedAt) : null;
      const stale = available && (Boolean(failure) || age > 120_000);
      res.writeHead(available ? 200 : 503, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Feed-Source': 'adsb.lol',
        'X-Feed-Cache': available ? (stale ? 'STALE' : 'HIT') : 'NONE',
        'X-Feed-Next-Refresh-Ms': String(Math.ceil(delay)),
        ...(age !== null ? { 'X-Feed-Age-Ms': String(Math.ceil(age)) } : {}),
        ...(!available
          ? { 'Retry-After': String(Math.ceil(delay / 1000)) }
          : {}),
      });
      res.end(
        req.method === 'HEAD'
          ? undefined
          : available
            ? cached.body
            : JSON.stringify({ error: 'Military data collection pending' }),
      );
    });
  }
  return {
    name: 'adsblol-proxy',
    configureServer: install,
    configurePreviewServer: install,
    closeBundle: close,
    ready: () => running || Promise.resolve(),
  };
}
