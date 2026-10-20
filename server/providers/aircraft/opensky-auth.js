/** OAuth credentials and bearer tokens never leave the server process. */
export function createOpenSkyAuth({
  environment = () => process.env,
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  let token = null,
    expiresAt = 0,
    pending = null,
    generation = 0;
  return {
    invalidate() {
      generation++;
      token = null;
      expiresAt = 0;
      pending = null;
    },
    async getToken() {
      if (token && now() < expiresAt - 60000) return token;
      if (pending) return pending;
      const env = environment();
      if (!env.OPENSKY_CLIENT_ID || !env.OPENSKY_CLIENT_SECRET) return null;
      const epoch = generation;
      const request = (async () => {
        try {
          const response = await fetchImpl(
            'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
            {
              method: 'POST',
              redirect: 'error',
              signal: AbortSignal.timeout(10000),
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: env.OPENSKY_CLIENT_ID,
                client_secret: env.OPENSKY_CLIENT_SECRET,
              }).toString(),
            },
          );
          const data = await response.json();
          const seconds =
            data.expires_in == null ? 1800 : Number(data.expires_in);
          if (
            !response.ok ||
            typeof data.access_token !== 'string' ||
            !data.access_token ||
            !Number.isFinite(seconds) ||
            seconds <= 0 ||
            generation !== epoch
          )
            return null;
          token = data.access_token;
          expiresAt = now() + seconds * 1000;
          return token;
        } catch {
          return null;
        }
      })();
      pending = request;
      try {
        return await request;
      } finally {
        if (pending === request) pending = null;
      }
    },
  };
}
const auth = createOpenSkyAuth();
export const getOpenSkyToken = () => auth.getToken();
export const invalidateOpenSkyToken = () => auth.invalidate();
