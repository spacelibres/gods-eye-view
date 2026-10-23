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
import { dirname, resolve } from 'node:path';
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

export const ADSB_DAY_MS = 86_400_000;
export const ADSB_REFRESH_MS = 240_000;
export const adsbStateDirectory = () =>
  resolve(process.env.GEV_ADSB_STATE_DIR || '.gev-cache/adsb');

function deadline(raw, now, { reset = false } = {}) {
  if (!raw) return 0;
  const seconds = /^\d+(?:\.\d+)?$/.test(raw.trim()) ? Number(raw) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) {
    const at =
      reset && seconds > 1e12
        ? seconds
        : reset && seconds > 1e9
          ? seconds * 1000
          : now + seconds * 1000;
    return Number.isSafeInteger(Math.ceil(at)) && at > now ? Math.ceil(at) : 0;
  }
  const at = Date.parse(raw);
  return Number.isFinite(at) && at > now ? at : 0;
}

const emptyState = () => ({ version: 1, attempts: [], holdUntil: 0 });

/** Cross-process atomic reservations. Corrupt/unwritable/locked state fails closed. */
export function createAdsbQuota({
  stateFile,
  now = () => Date.now(),
  fetchImpl = (...args) => globalThis.fetch(...args),
  militaryIntervalMs = ADSB_REFRESH_MS,
} = {}) {
  const path = () => stateFile || resolve(adsbStateDirectory(), 'quota.json');
  const markUncertain = () => {
    try {
      writeFileSync(
        path() + '.uncertain',
        'Vendor allowance could not be persisted; operator recovery required.\n',
        { flag: 'wx', mode: 0o600, flush: true },
      );
    } catch {
      /* Existing marker or unusable storage already prevents collection. */
    }
  };
  function transaction(action) {
    const file = path();
    if (existsSync(file + '.uncertain'))
      throw new Error('ADS-B quota needs operator recovery');
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const lock = file + '.lock';
    const fd = openSync(lock, 'wx', 0o600);
    let committed = false;
    let retryable = false;
    try {
      const state = existsSync(file)
        ? JSON.parse(readFileSync(file, 'utf8'))
        : emptyState();
      if (
        state.version !== 1 ||
        !Array.isArray(state.attempts) ||
        state.attempts.length > 500 ||
        !Number.isFinite(state.holdUntil) ||
        state.holdUntil < 0 ||
        (state.inFlight != null &&
          (!Number.isFinite(state.inFlight) || state.inFlight < 0)) ||
        (state.remaining != null &&
          (!Number.isSafeInteger(state.remaining) ||
            state.remaining < 0 ||
            !Number.isFinite(state.remainingUntil))) ||
        state.attempts.some(
          (a) =>
            !Number.isFinite(a.at) ||
            a.at < 0 ||
            !['military', 'ancillary'].includes(a.kind),
        )
      )
        throw new Error('Invalid ADS-B quota state');
      const at = now();
      // A process killed before persisting response headers leaves this durable
      // reservation unresolved. Only a full quota window can make it safe again.
      if (state.inFlight != null && at >= state.inFlight + ADSB_DAY_MS)
        delete state.inFlight;
      state.attempts = state.attempts.filter((a) => a.at > at - ADSB_DAY_MS);
      if (state.remainingUntil && at >= state.remainingUntil) {
        delete state.remaining;
        delete state.remainingUntil;
      }
      const result = action(state, at);
      const temporary = file + '.' + randomUUID() + '.tmp';
      try {
        writeFileSync(temporary, JSON.stringify(state), {
          mode: 0o600,
          flush: true,
        });
        renameSync(temporary, file);
        committed = true;
      } finally {
        if (existsSync(temporary)) unlinkSync(temporary);
      }
      return result;
    } catch (error) {
      // A sharing violation proves the atomic rename did not replace anything,
      // so the ledger is unchanged and the transaction can be retried.
      retryable = TRANSIENT_LEDGER_ERRORS.has(error?.code);
      throw error;
    } finally {
      closeSync(fd);
      // An uncertain persistence result must not allow another reservation, so
      // the lock stays. A retryable one is the opposite: nothing was written,
      // and keeping the lock would answer 503 until an operator removed it.
      if (committed || retryable) {
        try {
          unlinkSync(lock);
        } catch {
          /* Removal is best effort; the retry budget bounds the rest. */
        }
      }
    }
  }
  function wait(state, at, kind) {
    const rows = state.attempts;
    let until = state.holdUntil;
    if (state.inFlight != null)
      until = Math.max(
        until,
        at - state.inFlight >= 12_000
          ? state.inFlight + ADSB_DAY_MS
          : at + 1000,
      );
    if (rows.length)
      until = Math.max(until, Math.max(...rows.map((a) => a.at)) + 1000);
    const military = rows.filter((a) => a.kind === 'military');
    if (kind === 'military' && military.length)
      until = Math.max(
        until,
        Math.max(...military.map((a) => a.at)) + militaryIntervalMs,
      );
    if (state.remaining === 0) until = Math.max(until, state.remainingUntil);
    if (rows.length >= 500)
      until = Math.max(until, Math.min(...rows.map((a) => a.at)) + ADSB_DAY_MS);
    const ancillary = rows.filter((a) => a.kind === 'ancillary');
    if (kind !== 'military' && ancillary.length >= 140)
      until = Math.max(
        until,
        Math.min(...ancillary.map((a) => a.at)) + ADSB_DAY_MS,
      );
    return Math.max(0, until - at);
  }
  const limited = (status, delay) =>
    Response.json(
      { error: 'adsb.lol collection paused' },
      {
        status,
        headers: {
          'Retry-After': String(Math.max(1, Math.ceil(delay / 1000))),
          'X-ADS-B-Local-Limit': 'true',
        },
      },
    );
  /**
   * A peer holds the ledger lock for one short transaction, and Windows can
   * refuse the atomic rename while the target is open. Both are contention,
   * not a broken allowance, so a bounded retry re-runs the whole transaction;
   * nothing was persisted when it threw, so it cannot double-charge.
   */
  async function transactWithRetry(action) {
    const until = performance.now() + 1000;
    for (;;) {
      try {
        return transaction(action);
      } catch (error) {
        if (
          !TRANSIENT_LEDGER_ERRORS.has(error?.code) ||
          performance.now() >= until
        )
          throw error;
        await sleep(10);
      }
    }
  }
  return {
    waitMs(kind = 'ancillary') {
      try {
        return transaction((state, at) => wait(state, at, kind));
      } catch {
        return 60_000;
      }
    },
    async fetch(input, options = {}, kind = 'ancillary') {
      const url = new URL(input, 'https://api.adsb.lol');
      if (url.origin !== 'https://api.adsb.lol' || url.username || url.password)
        throw new Error('Invalid ADS-B origin');
      options.signal?.throwIfAborted();
      let delay;
      let reservationAt;
      try {
        delay = await transactWithRetry((state, at) => {
          const ms = wait(state, at, kind);
          if (!ms) {
            state.inFlight = at;
            reservationAt = at;
            state.attempts.push({
              at,
              kind: kind === 'military' ? 'military' : 'ancillary',
            });
            if (Number.isFinite(state.remaining))
              state.remaining = Math.max(0, state.remaining - 1);
          }
          return ms;
        });
      } catch (error) {
        return limited(503, 60_000);
      }
      if (delay) return limited(429, delay);
      // The durable reservation is recorded before any network operation.
      let response;
      try {
        const signal = AbortSignal.any(
          [options.signal, AbortSignal.timeout(12_000)].filter(Boolean),
        );
        response = await fetchImpl(url.href, {
          ...options,
          signal,
          redirect: 'error',
        });
      } catch (error) {
        try {
          await transactWithRetry((state) => {
            if (state.inFlight === reservationAt) delete state.inFlight;
          });
        } catch {
          markUncertain();
        }
        throw error;
      }
      const at = now();
      const retry = deadline(response.headers.get('retry-after'), at);
      const reset = deadline(
        response.headers.get('x-ratelimit-reset') ||
          response.headers.get('ratelimit-reset'),
        at,
        { reset: true },
      );
      const remaining =
        response.headers.get('x-ratelimit-remaining') ??
        response.headers.get('ratelimit-remaining');
      const exhausted = remaining !== null && Number(remaining) === 0;
      const until =
        response.status === 429 || exhausted
          ? Math.max(retry, reset || at + ADSB_DAY_MS)
          : retry;
      {
        try {
          await transactWithRetry((state) => {
            if (state.inFlight !== reservationAt)
              throw new Error('Unresolved ADS-B reservation');
            delete state.inFlight;
            state.holdUntil = Math.max(state.holdUntil, until);
            if (remaining !== null && /^\d+$/.test(remaining)) {
              state.remaining = Math.min(
                state.remaining ?? Infinity,
                Number(remaining),
              );
              state.remainingUntil = Math.max(
                state.remainingUntil || 0,
                reset || at + ADSB_DAY_MS,
              );
            }
          });
        } catch {
          markUncertain();
          await response.body?.cancel();
          return limited(503, ADSB_DAY_MS);
        }
      }
      return response;
    },
  };
}

export const sharedAdsbQuota = createAdsbQuota();
export const adsbLolFetch = (...args) => sharedAdsbQuota.fetch(...args);
