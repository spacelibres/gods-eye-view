import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Filesystem errors that mean "try again", not "the ledger is broken".
 *
 * On Windows an atomic rename of the state file intermittently fails with
 * EPERM while another process holds the target open, and a held lock file
 * makes the exclusive create fail with EEXIST. Neither says anything about the
 * vendor allowance; without a retry the first one leaves the lock in place and
 * every later request answers 503.
 */
const TRANSIENT_LEDGER_ERRORS = new Set(['EEXIST', 'EPERM', 'EACCES', 'EBUSY']);

export const OPENSKY_DAY_MS = 86_400_000;
export const OPENSKY_REFRESH_MS = 120_000;
const COST = 4;
export const openSkyStateDirectory = () =>
  resolve(process.env.GEV_OPENSKY_STATE_DIR || '.gev-cache/opensky');

function deadline(raw, now, reset = false) {
  if (!raw) return 0;
  const n = /^\d+(?:\.\d+)?$/.test(raw.trim()) ? Number(raw) : NaN;
  const at = Number.isFinite(n)
    ? reset && n > 1e12
      ? n
      : reset && n > 1e9
        ? n * 1000
        : now + n * 1000
    : Date.parse(raw);
  return Number.isSafeInteger(Math.ceil(at)) && at > now ? Math.ceil(at) : 0;
}

/** Separate weighted state/track credit buckets. Reservations precede network I/O. */
export function createOpenSkyQuota({
  bucket = 'states',
  directory,
  now = () => Date.now(),
  fetchImpl = (...args) => globalThis.fetch(...args),
  intervalMs = bucket === 'states' ? OPENSKY_REFRESH_MS : 1000,
  limitCredits = 4000,
} = {}) {
  if (!['states', 'tracks'].includes(bucket))
    throw new Error('Unknown OpenSky bucket');
  const file = () =>
    resolve(directory || openSkyStateDirectory(), `${bucket}-quota.json`);
  const uncertain = () => {
    try {
      writeFileSync(
        file() + '.uncertain',
        'OpenSky allowance needs operator recovery.\n',
        { flag: 'wx', mode: 0o600, flush: true },
      );
    } catch {
      /* An existing marker or unusable storage already blocks reservations. */
    }
  };
  function transaction(action, persist = true) {
    const name = file();
    if (existsSync(name + '.uncertain'))
      throw new Error('Uncertain OpenSky quota');
    mkdirSync(resolve(name, '..'), { recursive: true, mode: 0o700 });
    const lock = name + '.lock';
    const fd = openSync(lock, 'wx', 0o600);
    let committed = false;
    let retryable = false;
    try {
      const state = existsSync(name)
        ? JSON.parse(readFileSync(name, 'utf8'))
        : { version: 1, attempts: [], holdUntil: 0, nextAt: 0 };
      if (
        state.version !== 1 ||
        !Array.isArray(state.attempts) ||
        state.attempts.length > 1000 ||
        !Number.isFinite(state.holdUntil) ||
        state.holdUntil < 0 ||
        !Number.isFinite(state.nextAt) ||
        state.nextAt < 0 ||
        (state.inFlight != null &&
          (!Number.isFinite(state.inFlight) || state.inFlight < 0)) ||
        (state.remaining != null &&
          (!Number.isSafeInteger(state.remaining) ||
            state.remaining < 0 ||
            !Number.isFinite(state.remainingUntil))) ||
        state.attempts.some(
          (a) => !Number.isFinite(a.at) || a.at < 0 || a.cost !== COST,
        )
      )
        throw new Error('Invalid OpenSky ledger');
      const at = now();
      state.attempts = state.attempts.filter((a) => a.at > at - OPENSKY_DAY_MS);
      if (state.inFlight != null && at >= state.inFlight + OPENSKY_DAY_MS)
        delete state.inFlight;
      if (state.remainingUntil && at >= state.remainingUntil) {
        delete state.remaining;
        delete state.remainingUntil;
        state.nextAt = 0;
      }
      const value = action(state, at);
      if (persist) {
        const temporary = name + '.' + randomUUID() + '.tmp';
        try {
          writeFileSync(temporary, JSON.stringify(state), {
            mode: 0o600,
            flush: true,
          });
          renameSync(temporary, name);
        } finally {
          if (existsSync(temporary)) unlinkSync(temporary);
        }
      }
      committed = true;
      return value;
    } catch (error) {
      // A sharing violation proves the atomic rename did not replace anything,
      // so the ledger is unchanged and the transaction can be retried.
      retryable = TRANSIENT_LEDGER_ERRORS.has(error?.code);
      throw error;
    } finally {
      closeSync(fd);
      // Remove the lock we took after a commit, and after a retryable failure:
      // keeping that one would make every later attempt meet EEXIST and answer
      // 503 for good. An uncertain persist still leaves it for recovery.
      if (committed || retryable) {
        try {
          unlinkSync(lock);
        } catch {
          /* Removal is best effort; the retry budget bounds the rest. */
        }
      }
    }
  }
  function wait(state, at) {
    let until = Math.max(state.holdUntil, state.nextAt);
    if (state.inFlight != null)
      until = Math.max(
        until,
        at - state.inFlight >= 12000
          ? state.inFlight + OPENSKY_DAY_MS
          : at + 1000,
      );
    const last = state.attempts.at(-1)?.at;
    // Anonymous mode has only400 credits/day; a missing header cannot grant4000.
    const cadence =
      bucket === 'states' && intervalMs > 0
        ? Math.max(
            intervalMs,
            Math.ceil(OPENSKY_DAY_MS / (limitCredits / COST)),
          )
        : intervalMs;
    if (last != null) until = Math.max(until, last + cadence, last + 1000);
    if (state.remaining != null && state.remaining < COST)
      until = Math.max(until, state.remainingUntil);
    if (state.attempts.length * COST + COST > limitCredits)
      until = Math.max(until, state.attempts[0].at + OPENSKY_DAY_MS);
    return Math.max(0, until - at);
  }
  /**
   * A peer process holds the ledger lock for the length of one short
   * transaction, so meeting a held lock is ordinary contention — not a reason
   * to answer as if OpenSky were unavailable. Retries are bounded, and a lock
   * that stays wedged still fails closed at the caller.
   */
  async function transactWithRetry(action, persist = true) {
    const until = performance.now() + 1000;
    for (;;) {
      try {
        return transaction(action, persist);
      } catch (error) {
        // A retried transaction re-reads the ledger, and nothing was persisted
        // when it threw, so a retry cannot double-charge a request.
        if (
          !TRANSIENT_LEDGER_ERRORS.has(error?.code) ||
          performance.now() >= until
        )
          throw error;
        await sleep(10);
      }
    }
  }
  async function finalize(action) {
    // Peer ledger reads/writes hold a short lock. Do not turn ordinary
    // contention into a permanent uncertainty marker, or reissue the request.
    return transactWithRetry(action);
  }
  const denied = (status, ms) =>
    Response.json(
      { error: 'OpenSky collection paused' },
      {
        status,
        headers: {
          'Retry-After': String(Math.max(1, Math.ceil(ms / 1000))),
          'X-OpenSky-Local-Limit': 'true',
        },
      },
    );
  return {
    waitMs() {
      try {
        return transaction(wait, false);
      } catch {
        return 60000;
      }
    },
    async fetch(input, options = {}) {
      const url = new URL(input, 'https://opensky-network.org');
      if (
        url.origin !== 'https://opensky-network.org' ||
        url.username ||
        url.password ||
        url.pathname !== `/api/${bucket}/all`
      )
        throw new Error('Invalid OpenSky origin or bucket');
      options.signal?.throwIfAborted();
      let reservation;
      let delay;
      try {
        // The reservation is the first write of a request, so it is the lock
        // this process is most likely to find held by a peer. Waiting for it
        // keeps a busy ledger from turning into a 503 that never happened.
        delay = await transactWithRetry((state, at) => {
          const ms = wait(state, at);
          if (!ms) {
            reservation = at;
            state.inFlight = at;
            state.attempts.push({ at, cost: COST });
            if (state.remaining != null) state.remaining -= COST;
          }
          return ms;
        });
      } catch (error) {
        return denied(503, 60000);
      }
      if (delay) return denied(429, delay);
      let response;
      try {
        const signal = AbortSignal.any(
          [options.signal, AbortSignal.timeout(12000)].filter(Boolean),
        );
        response = await fetchImpl(url.href, {
          ...options,
          signal,
          redirect: 'error',
        });
      } catch (error) {
        try {
          await finalize((state) => {
            if (state.inFlight === reservation) delete state.inFlight;
          });
        } catch {
          uncertain();
        }
        throw error;
      }
      const at = now();
      const retry = Math.max(
        deadline(response.headers.get('x-rate-limit-retry-after-seconds'), at),
        deadline(response.headers.get('retry-after'), at),
      );
      const reset = deadline(
        response.headers.get('x-rate-limit-reset'),
        at,
        true,
      );
      const raw = response.headers.get('x-rate-limit-remaining');
      const parsedRemaining =
        raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
      const remaining = Number.isSafeInteger(parsedRemaining)
        ? parsedRemaining
        : null;
      try {
        await finalize((state) => {
          if (state.inFlight !== reservation)
            throw new Error('Unresolved OpenSky reservation');
          delete state.inFlight;
          const exhausted =
            response.status === 429 || (remaining !== null && remaining < COST);
          if (exhausted)
            state.holdUntil = Math.max(
              state.holdUntil,
              retry,
              reset,
              retry || reset ? 0 : at + OPENSKY_DAY_MS,
            );
          else state.holdUntil = Math.max(state.holdUntil, retry);
          if (remaining !== null) {
            state.remaining = Math.min(state.remaining ?? Infinity, remaining);
            state.remainingUntil =
              reset || state.remainingUntil || at + OPENSKY_DAY_MS;
            if (exhausted && retry)
              state.remainingUntil = Math.max(at + 1, retry, reset);
            if (bucket === 'states' && state.remaining >= COST) {
              const spread = Math.ceil(
                (state.remainingUntil - at) /
                  Math.floor(state.remaining / COST),
              );
              state.nextAt = Math.max(
                state.nextAt,
                reservation + intervalMs,
                at + spread,
              );
            }
          }
        });
      } catch {
        uncertain();
        try {
          void response.body?.cancel().catch(() => {});
        } catch {
          /* Cancellation cannot delay the fail-closed response. */
        }
        return denied(503, OPENSKY_DAY_MS);
      }
      return response;
    },
  };
}

const anonymous = () =>
  String(process.env.OPENSKY_AUTH_MODE || '')
    .trim()
    .toLowerCase() === 'anon';
const states = new Map(),
  tracks = new Map();
function shared(bucket, args) {
  const directory = openSkyStateDirectory(),
    limitCredits = anonymous() ? 400 : 4000;
  const pool = bucket === 'states' ? states : tracks;
  const key = directory + ':' + limitCredits;
  if (!pool.has(key))
    pool.set(key, createOpenSkyQuota({ bucket, directory, limitCredits }));
  return pool.get(key).fetch(...args);
}
export const sharedOpenSkyStatesQuota = {
  fetch: (...args) => shared('states', args),
  waitMs: () =>
    createOpenSkyQuota({ limitCredits: anonymous() ? 400 : 4000 }).waitMs(),
};
export const sharedOpenSkyTracksQuota = {
  fetch: (...args) => shared('tracks', args),
  waitMs: () =>
    createOpenSkyQuota({
      bucket: 'tracks',
      limitCredits: anonymous() ? 400 : 4000,
    }).waitMs(),
};
