import {
  epoch,
  finite,
  httpError,
  LiveSourceError,
  readResponse,
} from './contract.js';
import {
  normalizeAircraftTrack,
  openSkySnapshot,
  readsbSnapshot,
  readsbIdentities,
} from './aircraft.js';
import { normalizeVesselTrack, vesselSnapshot } from './vessels.js';

const defaultFetch = (...args) => globalThis.fetch(...args);
const defaultNow = () => Date.now();
const militarySources = new WeakMap();
const flightSources = new WeakMap();
const header = (response, name) => response.headers?.get?.(name);

function openSkyError(response) {
  const error = httpError(response, 'Flights');
  const mode = String(
    header(response, 'x-opensky-auth-mode-used') ||
      header(response, 'x-opensky-auth') ||
      '',
  ).toLowerCase();
  const reason = String(
    header(response, 'x-opensky-auth-reason') || '',
  ).toLowerCase();
  if (response.status === 429 && (!mode || mode === 'anon'))
    error.message = 'OpenSky rate limited (anonymous)';
  if (response.status === 401 || response.status === 403) {
    const reasons = {
      oauth_invalid_or_missing: 'OpenSky OAuth client missing/invalid',
      oauth_invalid_credentials: 'OpenSky OAuth rejected credentials',
      basic_invalid_credentials: 'OpenSky username/password rejected',
      missing_basic_creds: 'OpenSky auth missing',
      missing_oauth_and_basic_creds: 'OpenSky auth missing',
      auth_required: 'OpenSky auth required',
      forced_anonymous: 'OpenSky auth required',
    };
    error.message =
      reasons[reason] ||
      (/^(oauth_|basic_)/.test(reason)
        ? 'OpenSky auth invalid'
        : mode === 'anon'
          ? 'OpenSky auth required'
          : 'OpenSky auth failed');
  }
  return error;
}

/**
 * The provider a feed response names in `X-Feed-Source`, so a server that
 * answers a feed route from another provider is reported as that provider.
 */
function feedSource(response, fallback) {
  const named = header(response, 'x-feed-source');
  return typeof named === 'string' && named.trim()
    ? named.trim().slice(0, 80)
    : fallback;
}

/** The flights feed (/api/flights); no request starts during construction. */
export function createFlightSource({
  fetchImpl = defaultFetch,
  now = defaultNow,
} = {}) {
  let clocks = flightSources.get(fetchImpl);
  if (!clocks) flightSources.set(fetchImpl, (clocks = new WeakMap()));
  if (clocks.has(now)) return clocks.get(now);
  const fallbackIntervalMs = 120000;
  let cached;
  let nextReadAtMs = 0;
  let cachedAtMs = 0;
  let pending;

  let cachedUrl;
  const globalResult = (r) =>
    !r?.response ||
    !header(r.response, 'x-flight-coverage') ||
    /global|worldwide/i.test(header(r.response, 'x-flight-coverage'));
  function load(url) {
    const controller = new AbortController();
    const request = { controller, consumers: 0, settled: false, url };
    pending = request;
    request.promise = (async () => {
      let result;
      let intervalMs = fallbackIntervalMs;
      try {
        const { response, payload } = await readResponse(
          fetchImpl,
          url,
          { signal: controller.signal },
          'Flights',
        );
        const receivedAtMs = now();
        const advertised = finite(header(response, 'x-feed-next-refresh-ms'));
        intervalMs =
          advertised === 0
            ? 0
            : Math.max(1000, advertised ?? fallbackIntervalMs);
        if (!response.ok) {
          const error = openSkyError(response);
          const retry = header(response, 'retry-after');
          const seconds = finite(retry);
          const retryMs =
            seconds != null ? seconds * 1000 : Date.parse(retry) - receivedAtMs;
          intervalMs = Math.max(
            intervalMs,
            Number.isFinite(retryMs) ? retryMs : 0,
          );
          error.retryAfterMs = intervalMs;
          throw error;
        }
        const age = finite(header(response, 'x-feed-age-ms'));
        result = {
          response,
          payload,
          observedAtMs:
            age != null && age >= 0
              ? receivedAtMs - age
              : epoch(payload?.time, 1000),
        };
      } catch (error) {
        if (controller.signal.aborted) throw error;
        error.retryAfterMs = intervalMs;
        result = { error };
      }
      controller.signal.throwIfAborted();
      cached = result;
      cachedUrl = url;
      cachedAtMs = now();
      nextReadAtMs = cachedAtMs + intervalMs;
      return result;
    })().finally(() => {
      request.settled = true;
      if (pending === request) pending = null;
    });
    return request;
  }

  async function read(url, { signal } = {}) {
    signal?.throwIfAborted();
    let result;
    if (
      cached &&
      (cachedUrl === url || globalResult(cached)) &&
      now() >= cachedAtMs &&
      now() < nextReadAtMs
    )
      result = cached;
    else {
      if (pending && pending.url !== url) {
        await read(pending.url, { signal });
        return read(url, { signal });
      }
      const request = pending || load(url);
      request.consumers++;
      let onAbort;
      try {
        result = await (signal
          ? Promise.race([
              request.promise,
              new Promise((_resolve, reject) => {
                onAbort = () => reject(signal.reason);
                signal.addEventListener('abort', onAbort, { once: true });
              }),
            ])
          : request.promise);
      } finally {
        if (onAbort) signal.removeEventListener('abort', onAbort);
        request.consumers--;
        if (!request.settled && request.consumers === 0) {
          if (pending === request) pending = null;
          request.controller.abort();
        }
      }
    }
    signal?.throwIfAborted();
    if (result.error) throw result.error;
    return result;
  }

  const source = {
    // i18n-ignore: feed source name, replaced by provider metadata
    label: 'Flights',
    async getSnapshot(query = {}, options = {}) {
      const params = new URLSearchParams();
      if (
        fetchImpl !== defaultFetch &&
        Number.isFinite(query.latitude) &&
        Number.isFinite(query.longitude)
      ) {
        params.set('lat', query.latitude.toFixed(4));
        params.set('lon', query.longitude.toFixed(4));
      }
      const { response, payload, observedAtMs } = await read(
        `/api/flights${params.size ? '?' + params : ''}`,
        options,
      );
      const currentTimeMs = now();
      const snapshot = openSkySnapshot(payload, {
        source:
          header(response, 'x-flight-source') ||
          feedSource(response, 'Flights'),
        coverage:
          header(response, 'x-flight-coverage') ||
          'worldwide upstream snapshot',
        now: currentTimeMs,
        stale:
          header(response, 'x-opensky-cache') === 'STALE' ||
          header(response, 'x-feed-cache') === 'STALE',
      });
      const sourceTimeMs = snapshot.observedAtMs ?? observedAtMs;
      const ageMs =
        sourceTimeMs == null ? null : Math.max(0, currentTimeMs - sourceTimeMs);
      const stale = snapshot.stale || (ageMs != null && ageMs > 120000);
      return {
        ...snapshot,
        observedAtMs: sourceTimeMs,
        ageMs,
        stale,
        freshness:
          sourceTimeMs == null ? 'unknown' : stale ? 'stale' : 'current',
        status: response.status,
      };
    },
    async getTrack(reference, { signal } = {}) {
      const { response, payload } = await readResponse(
        fetchImpl,
        '/api/flights/track?icao24=' + encodeURIComponent(reference),
        { signal },
        'Flights',
      );
      if (!response.ok) throw httpError(response, 'Flights');
      return {
        records: normalizeAircraftTrack(payload?.path),
        complete: false,
      };
    },
    async getEnrichment(query, { signal } = {}) {
      if (!['type', 'route'].includes(query.kind))
        throw new LiveSourceError('unsupported', 'Enrichment unavailable');
      const { response, payload } = await readResponse(
        fetchImpl,
        `/api/adsbdb/${query.kind}/${encodeURIComponent(query.id)}`,
        { signal },
        'adsbdb',
      );
      if (!response.ok) throw httpError(response, 'adsbdb');
      return payload;
    },
  };
  clocks.set(now, source);
  return source;
}

export function createMilitarySource({
  fetchImpl = defaultFetch,
  now = defaultNow,
} = {}) {
  let sourcesByClock = militarySources.get(fetchImpl);
  if (!sourcesByClock) {
    sourcesByClock = new WeakMap();
    militarySources.set(fetchImpl, sourcesByClock);
  }
  const existing = sourcesByClock.get(now);
  if (existing) return existing;

  const fallbackIntervalMs = 240000;
  let cached;
  let nextReadAtMs = 0;
  let cachedAtMs = 0;
  let pending;

  function load() {
    const controller = new AbortController();
    const request = { controller, consumers: 0, settled: false };
    pending = request;
    request.promise = (async () => {
      let result;
      let intervalMs = fallbackIntervalMs;
      try {
        const { response, payload } = await readResponse(
          fetchImpl,
          '/api/military',
          { signal: controller.signal },
          'Military aircraft',
        );
        const receivedAtMs = now();
        const advertised = finite(header(response, 'x-feed-next-refresh-ms'));
        intervalMs =
          advertised === 0
            ? 0
            : Math.max(1000, advertised ?? fallbackIntervalMs);
        if (!response.ok) {
          const error = httpError(response, 'Military aircraft');
          const retry = header(response, 'retry-after');
          const seconds = finite(retry);
          const retryMs =
            seconds != null ? seconds * 1000 : Date.parse(retry) - receivedAtMs;
          intervalMs = Math.max(
            intervalMs,
            Number.isFinite(retryMs) ? retryMs : 0,
          );
          error.retryAfterMs = intervalMs;
          throw error;
        }
        const age = finite(header(response, 'x-feed-age-ms'));
        result = {
          response,
          payload,
          observedAtMs:
            age != null && age >= 0
              ? receivedAtMs - age
              : epoch(payload?.now, 1000),
        };
      } catch (error) {
        if (controller.signal.aborted) throw error;
        error.retryAfterMs = intervalMs;
        result = { error };
      }
      controller.signal.throwIfAborted();
      cached = result;
      cachedAtMs = now();
      nextReadAtMs = cachedAtMs + intervalMs;
      return result;
    })().finally(() => {
      request.settled = true;
      if (pending === request) pending = null;
    });
    return request;
  }

  async function read({ signal } = {}) {
    signal?.throwIfAborted();
    let result;
    if (cached && now() >= cachedAtMs && now() < nextReadAtMs) result = cached;
    else {
      const request = pending || load();
      request.consumers++;
      let onAbort;
      try {
        result = await (signal
          ? Promise.race([
              request.promise,
              new Promise((_resolve, reject) => {
                onAbort = () => reject(signal.reason);
                signal.addEventListener('abort', onAbort, { once: true });
              }),
            ])
          : request.promise);
      } finally {
        if (onAbort) signal.removeEventListener('abort', onAbort);
        request.consumers--;
        if (!request.settled && request.consumers === 0) {
          if (pending === request) pending = null;
          request.controller.abort();
        }
      }
    }
    signal?.throwIfAborted();
    if (result.error) throw result.error;
    return result;
  }

  const source = {
    // i18n-ignore: feed source name, replaced by the provider from each snapshot and reported to AI tools
    label: 'Military aircraft',
    async getIdentities(_query = {}, options = {}) {
      const { payload } = await read(options);
      return readsbIdentities(payload);
    },
    async getSnapshot(_query = {}, options = {}) {
      const { response, payload, observedAtMs } = await read(options);
      const currentTimeMs = now();
      return {
        ...readsbSnapshot(payload, {
          source: feedSource(response, 'Military aircraft'),
          observedAtMs,
          now: currentTimeMs,
          stale:
            header(response, 'x-feed-cache') === 'STALE' ||
            (observedAtMs != null && currentTimeMs - observedAtMs > 120000),
        }),
        status: response.status,
      };
    },
    async getTrack(reference, { signal } = {}) {
      const { response, payload } = await readResponse(
        fetchImpl,
        '/api/military/track?hex=' + encodeURIComponent(reference),
        { signal },
        'Military aircraft',
      );
      if (!response.ok) throw httpError(response, 'Military aircraft');
      const baseTimeMs = epoch(payload?.timestamp, 1000);
      return {
        records:
          baseTimeMs == null
            ? []
            : normalizeAircraftTrack(payload?.trace, {
                baseTimeMs,
                readsb: true,
              }),
        complete: false,
      };
    },
  };
  sourcesByClock.set(now, source);
  return source;
}

export function createVesselSource({
  fetchImpl = defaultFetch,
  apiUrl = '/api/vessels',
  origin = () => globalThis.location?.origin || 'http://localhost',
} = {}) {
  return {
    // i18n-ignore: feed source name, replaced by the provider from each snapshot and reported to AI tools
    label: 'Vessels',
    async getSnapshot({ maxRows = 12000, area } = {}, { signal } = {}) {
      const url = new URL(apiUrl, origin());
      url.searchParams.set('maxRows', String(maxRows));
      // An area asks for the vessels around a point; servers that hold every
      // vessel may ignore it, since callers still keep only what they need.
      if (
        Number.isFinite(area?.lat) &&
        Number.isFinite(area?.lon) &&
        Number.isFinite(area?.radiusKm)
      ) {
        url.searchParams.set('lat', area.lat.toFixed(5));
        url.searchParams.set('lon', area.lon.toFixed(5));
        url.searchParams.set('radius_km', area.radiusKm.toFixed(1));
      }
      const { response, payload } = await readResponse(
        fetchImpl,
        url.toString(),
        { signal, cache: 'no-store' },
        'Vessels',
      );
      if (!response.ok) {
        const error = httpError(response, 'Vessels');
        const reasons = {
          'missing-key': 'AISSTREAM_API_KEY not set',
          'auth-failed': 'API key rejected — check AISSTREAM_API_KEY',
          unsupported: 'live feed unsupported',
          error: 'feed down',
          closed: 'feed disconnected',
        };
        error.message = reasons[payload?.status] || error.message;
        throw error;
      }
      return {
        ...vesselSnapshot(payload, { source: feedSource(response, 'Vessels') }),
        status: response.status,
      };
    },
    async getTrack(reference, { signal } = {}) {
      const { response, payload } = await readResponse(
        fetchImpl,
        '/api/vessels/track?mmsi=' + encodeURIComponent(reference),
        { signal },
        'Vessels',
      );
      if (!response.ok) throw httpError(response, 'Vessels');
      return {
        records: normalizeVesselTrack(payload?.samples),
        complete: false,
      };
    },
  };
}
