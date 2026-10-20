import { enforceRateLimit, openAiRateLimiter } from '../openai/rate-limit.js';

/**
 * Volcengine Doubao realtime credential.
 *
 * This service does not mint per-session tokens: the socket authenticates with
 * the account's App ID and access token directly. They are still kept on the
 * server, because handing them to a page would let any visitor spend the
 * account's quota and impersonate the application.
 *
 * The route answers 503 naming the missing variable when the deployment holds
 * no credential, which is how the picker decides the provider is unavailable.
 *
 * @param {{resolveAppId?: () => string, resolveAccessToken?: () => string,
 *   environment?: object}} [options]
 */
export function createDoubaoTokenHandler({
  resolveAppId = () => process.env.DOUBAO_APP_ID,
  resolveAccessToken = () => process.env.DOUBAO_ACCESS_TOKEN,
  environment = process.env,
} = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const appId = String(resolveAppId() ?? '').trim();
    const accessToken = String(resolveAccessToken() ?? '').trim();
    if (!appId || !accessToken) {
      res.statusCode = 503;
      res.end(
        JSON.stringify({
          error: appId
            ? 'DOUBAO_ACCESS_TOKEN is not set'
            : 'DOUBAO_APP_ID is not set',
        }),
      );
      return;
    }

    if (!enforceRateLimit(openAiRateLimiter(), req, res)) return;

    const systemRole = String(environment.DOUBAO_SYSTEM_ROLE ?? '').trim();
    res.statusCode = 200;
    res.setHeader('X-GEV-Voice-Model', 'doubao-realtime');
    res.end(
      JSON.stringify({
        appId,
        accessToken,
        model: systemRole || null,
        session: { model: 'doubao-realtime' },
      }),
    );
  };
}
