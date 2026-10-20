import { createAirportCollector } from './collector.js';
import {
  airportIndexes,
  metadata,
  queryAirports,
  searchAirports,
} from './model.js';
export function airportsProxy(options = {}) {
  let collector = options.collector;
  let ready;
  const start = () => {
    if (!collector) collector = createAirportCollector(options);
    ready = collector.ready;
    return ready;
  };
  async function middleware(req, res, next) {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return next();
    }
    if (
      ![
        '/api/airports',
        '/api/airports/search',
        '/api/airports/detail',
      ].includes(url.pathname)
    )
      return next();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    const send = (status, body) => {
      res.statusCode = status;
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return send(405, { error: 'Method not allowed' });
    }
    try {
      await start();
    } catch {
      return send(503, { error: 'Airport directory unavailable' });
    }
    const snapshot = collector.readSnapshot
      ? await collector.readSnapshot()
      : collector.getSnapshot();
    if (!snapshot) return send(503, { error: 'Airport directory unavailable' });
    const q = Object.fromEntries(url.searchParams);
    try {
      if (url.pathname.endsWith('/detail')) {
        if (!q.id || q.id.length > 30)
          return send(400, { error: 'Airport ID required' });
        const airport = airportIndexes(snapshot).ids.get(q.id);
        return airport
          ? send(200, { ...metadata(snapshot), airport })
          : send(404, { error: 'Airport not found' });
      }
      if (url.pathname.endsWith('/search'))
        return send(
          200,
          searchAirports(snapshot, q.q, {
            limit: q.limit === undefined ? 8 : q.limit,
          }),
        );
      return send(200, queryAirports(snapshot, q));
    } catch {
      return send(400, { error: 'Invalid airport query' });
    }
  }
  const install = (server) => {
    start().catch((error) => options.onError?.(error));
    server.middlewares.use(middleware);
    server.httpServer?.once('close', () => {
      void collector?.close();
    });
  };
  return {
    name: 'airports-proxy',
    configureServer: install,
    configurePreviewServer: install,
    get ready() {
      return ready || start();
    },
    async closeBundle() {
      await collector?.close();
    },
  };
}
