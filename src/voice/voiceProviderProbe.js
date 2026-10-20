/**
 * Which voice services this deployment can actually run.
 *
 * A provider's credential lives on the server, so the only honest answer comes
 * from asking that server. The probes are the same routes the session uses to
 * mint a credential: a route that answers "configured" is one that will hand
 * out a token, and one that answers 503 naming a missing variable will not.
 *
 * Probing costs one request per provider at startup and is cached for the page
 * lifetime — the deployment's environment does not change while a tab is open.
 */

/** Route that mints each provider's credential. */
const PROBE_ROUTES = Object.freeze({
  openai: '/api/realtime/token?probe=1',
  dashscope: '/api/dashscope/token?probe=1',
});

/** Answer from the last probe, so a dialog opening does not re-hit the server. */
let cached = null;

/**
 * Ask the server whether one provider is configured.
 *
 * Any non-503 answer counts as configured: a 200 is a real token, and a 4xx is
 * a route that exists and was reached. A 503 is the route's own way of saying
 * the variable is missing, which is exactly the case to avoid.
 *
 * @param {string} id
 * @param {{fetchImpl?: Function, signal?: AbortSignal}} [options]
 * @returns {Promise<boolean>}
 */
export async function probeVoiceProvider(
  id,
  { fetchImpl = (...args) => fetch(...args), signal } = {},
) {
  const route = PROBE_ROUTES[id];
  // A provider without a probe route is left unjudged rather than assumed
  // broken: hiding a service that works would be the worse error.
  if (!route) return true;
  try {
    const response = await fetchImpl(route, {
      method: 'GET',
      cache: 'no-store',
      signal,
    });
    await response.body?.cancel?.().catch?.(() => {});
    return response.status !== 503;
  } catch {
    return false;
  }
}

/**
 * Probe every provider once, then answer from the cache.
 *
 * @param {{fetchImpl?: Function, signal?: AbortSignal,
 *   force?: boolean}} [options]
 * @returns {Promise<Record<string, boolean>>}
 */
export async function probeVoiceProvidersCached({
  fetchImpl,
  signal,
  force = false,
} = {}) {
  if (cached && !force) return cached;
  const ids = Object.keys(PROBE_ROUTES);
  const entries = await Promise.all(
    ids.map(async (id) => [
      id,
      await probeVoiceProvider(id, { fetchImpl, signal }),
    ]),
  );
  // A cancelled page must not poison the cache for the next start.
  if (signal?.aborted) return Object.fromEntries(entries);
  cached = Object.fromEntries(entries);
  return cached;
}

/** Forget the cache; used by tests and by a reconnect after a config change. */
export function resetVoiceProviderProbeCache() {
  cached = null;
}
