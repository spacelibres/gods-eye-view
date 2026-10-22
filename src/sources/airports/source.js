import {
  isAirportRecord,
  AIRPORT_TYPES,
  isNavaidRecord,
  isCountryRecord,
  NAVAID_TYPES,
} from './records.js';
import { readResponseJsonCapped } from '../httpBody.js';

const limitValue = (value, fallback) =>
  Math.max(1, Math.min(2000, Math.trunc(Number(value) || fallback)));
function validate(data, detail) {
  if (
    !data ||
    typeof data.revision !== 'string' ||
    !data.revision ||
    !Number.isFinite(Date.parse(data.updatedAt)) ||
    data.source !== 'OurAirports' ||
    typeof data.sourceUrl !== 'string'
  )
    throw new Error('Invalid airport response');
  if (detail === 'countries') {
    if (
      !Array.isArray(data.countries) ||
      data.countries.length > 500 ||
      !data.countries.every(isCountryRecord) ||
      new Set(data.countries.map((r) => r.code)).size !== data.countries.length
    )
      throw new Error('Invalid country list');
    return data;
  }
  if (detail === 'navaids') {
    if (
      !Array.isArray(data.navaids) ||
      data.navaids.length > 1200 ||
      !data.navaids.every(isNavaidRecord) ||
      !Number.isInteger(data.total) ||
      !Number.isInteger(data.matched) ||
      data.total < data.matched ||
      data.matched < data.navaids.length ||
      typeof data.truncated !== 'boolean' ||
      data.truncated !== data.matched > data.navaids.length
    )
      throw new Error('Invalid navaid list');
    return data;
  }
  if (detail) {
    if (!isAirportRecord(data.airport))
      throw new Error('Invalid airport detail');
  } else if (
    !Array.isArray(data.airports) ||
    data.airports.length > 2000 ||
    !data.airports.every(isAirportRecord) ||
    !Number.isInteger(data.total) ||
    !Number.isInteger(data.matched) ||
    data.total < data.matched ||
    data.matched < data.airports.length ||
    typeof data.truncated !== 'boolean' ||
    data.truncated !== data.matched > data.airports.length
  )
    throw new Error('Invalid airport list');
  return data;
}
/** Same-origin bounded directory reads, with independently cancellable consumers. */
export function createAirportSource({
  fetchImpl = (...args) => fetch(...args),
  baseUrl = '/api/airports',
  getLocale = () => 'en',
  now = Date.now,
  timeoutMs = 12_000,
} = {}) {
  const cache = new Map(),
    pending = new Map(),
    translationVersions = new Map();
  let revision;
  function read(path, params, signal, detail = false) {
    signal?.throwIfAborted();
    params.set('lang', getLocale() || 'en');
    const url = `${baseUrl}${path}?${params}`;
    const hit = cache.get(url);
    if (hit && hit.expires > now()) return Promise.resolve(hit.data);
    let request = pending.get(url);
    if (!request) {
      const controller = new AbortController();
      request = { controller, consumers: 0, settled: false };
      pending.set(url, request);
      let removeAbort;
      const interrupted = new Promise((_, reject) => {
        const abort = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', abort, { once: true });
        removeAbort = () =>
          controller.signal.removeEventListener('abort', abort);
      });
      const timer = setTimeout(
        () =>
          controller.abort(
            new DOMException('Airport request timed out', 'TimeoutError'),
          ),
        Math.max(1, Number(timeoutMs) || 12_000),
      );
      const work = Promise.resolve()
        .then(() => fetchImpl(url, { signal: controller.signal }))
        .then(async (response) => {
          if (controller.signal.aborted) {
            void response.body?.cancel()?.catch(() => {});
            controller.signal.throwIfAborted();
          }
          if (!response.ok) {
            void response.body?.cancel()?.catch(() => {});
            throw new Error(`Airport request failed (${response.status})`);
          }
          const data = validate(
            await readResponseJsonCapped(
              response,
              4_000_000,
              controller.signal,
            ),
            detail,
          );
          controller.signal.throwIfAborted();
          if (detail === true && data.airport.id !== params.get('id'))
            throw new Error('Mismatched airport detail');
          if (revision !== data.revision) {
            cache.clear();
            translationVersions.clear();
            revision = data.revision;
          }
          const locale = params.get('lang') || 'en';
          const translationVersion = data.translationRevision || '';
          if (
            translationVersions.has(locale) &&
            translationVersions.get(locale) !== translationVersion
          ) {
            for (const cachedUrl of cache.keys()) {
              if (
                new URL(cachedUrl, 'http://localhost').searchParams.get(
                  'lang',
                ) === locale
              )
                cache.delete(cachedUrl);
            }
          }
          translationVersions.set(locale, translationVersion);
          cache.set(url, { data, expires: now() + 30_000 });
          while (cache.size > 64) cache.delete(cache.keys().next().value);
          return data;
        });
      request.promise = Promise.race([work, interrupted]).finally(() => {
        clearTimeout(timer);
        removeAbort();
        request.settled = true;
        if (pending.get(url) === request) pending.delete(url);
      });
    }
    request.consumers++;
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abort);
        request.consumers--;
        if (!request.settled && !request.consumers) {
          pending.delete(url);
          request.controller.abort();
        }
        fn(value);
      };
      const abort = () =>
        done(
          reject,
          signal.reason || new DOMException('Aborted', 'AbortError'),
        );
      signal?.addEventListener('abort', abort, { once: true });
      request.promise.then(
        (value) => done(resolve, value),
        (error) => done(reject, error),
      );
      if (signal?.aborted) abort();
    });
  }
  return {
    getCountries({ signal } = {}) {
      return read('/countries', new URLSearchParams(), signal, 'countries');
    },
    getNavaids({ bounds, limit, signal, q, type } = {}) {
      const params = new URLSearchParams({
        limit: Math.min(1200, limitValue(limit, 1200)),
      });
      if (bounds) {
        for (const key of ['west', 'south', 'east', 'north']) {
          const value = bounds[key];
          if (
            !Number.isFinite(value) ||
            Math.abs(value) > (key === 'south' || key === 'north' ? 90 : 180)
          )
            throw new TypeError('Invalid navaid bounds');
          params.set(key, value);
        }
        if (bounds.south > bounds.north)
          throw new TypeError('Invalid navaid bounds');
      }
      if (type !== undefined) {
        if (!NAVAID_TYPES.includes(type))
          throw new TypeError('Invalid navaid type');
        params.set('type', type);
      }
      if (q !== undefined) params.set('q', String(q).trim().slice(0, 200));
      return read('/navaids', params, signal, 'navaids');
    },
    getSnapshot({ bounds, types, limit, signal } = {}) {
      const params = new URLSearchParams({ limit: limitValue(limit, 1200) });
      if (bounds) {
        for (const key of ['west', 'south', 'east', 'north']) {
          const value = bounds[key];
          if (
            !Number.isFinite(value) ||
            Math.abs(value) > (key === 'south' || key === 'north' ? 90 : 180)
          )
            throw new TypeError('Invalid airport bounds');
          params.set(key, value);
        }
        if (bounds.south > bounds.north)
          throw new TypeError('Invalid airport bounds');
      }
      if (types) {
        if (
          !Array.isArray(types) ||
          types.some((type) => !AIRPORT_TYPES.includes(type))
        )
          throw new TypeError('Invalid airport types');
        params.set('types', [...new Set(types)].sort().join(','));
      }
      return read('', params, signal);
    },
    search(query, { limit, signal } = {}) {
      return read(
        '/search',
        new URLSearchParams({
          q: String(query ?? '')
            .trim()
            .slice(0, 200),
          limit: limitValue(limit, 8),
        }),
        signal,
      );
    },
    getAirport(id, { signal } = {}) {
      if (!/^\d+$/.test(String(id))) throw new TypeError('Invalid airport ID');
      return read(
        '/detail',
        new URLSearchParams({ id: String(id) }),
        signal,
        true,
      );
    },
  };
}
