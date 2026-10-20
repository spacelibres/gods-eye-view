import { enforceRateLimit, openAiRateLimiter } from '../openai/rate-limit.js';

/** DashScope issues temporary tokens here; the account key never leaves the server. */
const DEFAULT_TOKEN_ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/tokens';

/**
 * Default realtime model.
 *
 * Verified against the live service. `qwen3-omni-flash-realtime` connects and
 * then rejects every event with `1007 Model not exist.`; the dated
 * `qwen3.8-omni-flash-realtime` runs a session and accepts `session.update`.
 * `DASHSCOPE_REALTIME_MODEL` overrides it when a deployment pins a build.
 */
export const DASHSCOPE_REALTIME_MODEL_DEFAULT = 'qwen3.8-omni-flash-realtime';

/**
 * Mint a short-lived token for the browser's WebSocket.
 *
 * The flow mirrors the OpenAI side deliberately: the browser asks this route
 * for a credential, the server asks DashScope with the account key, and the
 * browser then opens `wss://…/api-ws/v1/realtime` with that credential. The
 * account key is never sent to a page.
 *
 * @param {{endpoint?: string, fetchImpl?: Function,
 *   resolveApiKey?: () => string, environment?: object,
 *   expireSeconds?: number}} [options]
 */
export function createDashScopeTokenHandler({
  endpoint = DEFAULT_TOKEN_ENDPOINT,
  fetchImpl = (...args) => fetch(...args),
  resolveApiKey = () => process.env.DASHSCOPE_API_KEY,
  environment = process.env,
  expireSeconds = 1800,
} = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const apiKey = String(resolveApiKey() ?? '').trim();
    if (!apiKey) {
      // The client reads this to decide whether the provider is usable, so the
      // name of the missing variable is part of the contract.
      res.statusCode = 503;
      res.end(JSON.stringify({ error: 'DASHSCOPE_API_KEY is not set' }));
      return;
    }

    // Same per-IP throttle as the OpenAI route: this route spends the account's
    // quota every time it is called.
    if (!enforceRateLimit(openAiRateLimiter(), req, res)) return;

    const model =
      String(environment.DASHSCOPE_REALTIME_MODEL ?? '').trim() ||
      DASHSCOPE_REALTIME_MODEL_DEFAULT;

    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expire_in: expireSeconds }),
      });
      const body = await response.text();
      if (!response.ok) {
        console.warn(`[dashscope-token] upstream HTTP ${response.status}`);
        res.statusCode = response.status === 401 ? 401 : 502;
        res.end(JSON.stringify({ error: 'Failed to create DashScope token' }));
        return;
      }
      let data;
      try {
        data = JSON.parse(body);
      } catch {
        res.statusCode = 502;
        res.end(
          JSON.stringify({ error: 'DashScope returned an unreadable token' }),
        );
        return;
      }
      if (typeof data?.token !== 'string' || !data.token) {
        res.statusCode = 502;
        res.end(JSON.stringify({ error: 'DashScope returned no token' }));
        return;
      }
      // `expires_at` is seconds since the epoch, as on the OpenAI side, so the
      // client's expiry check works unchanged.
      res.statusCode = 200;
      res.setHeader('X-GEV-Voice-Model', model);
      res.end(
        JSON.stringify({
          value: data.token,
          expires_at: data.expires_at,
          session: { model },
        }),
      );
    } catch {
      console.warn('[dashscope-token] mint failed');
      res.statusCode = 502;
      res.end(JSON.stringify({ error: 'Failed to create DashScope token' }));
    }
  };
}
