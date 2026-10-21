import { AIRPORT_SOURCE_FILES } from './archive.js';
import { createAirportCollector } from './collector.js';
import {
  airportIndexes,
  metadata,
  queryAirports,
  queryNavaids,
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
    const fileMatch = /^\/api\/airports\/files\/([a-z-]+\.csv)$/.exec(
      url.pathname,
    );
    if (
      !fileMatch &&
      ![
        '/api/airports',
        '/api/airports/search',
        '/api/airports/detail',
        '/api/airports/navaids',
        '/api/airports/countries',
        '/api/airports/provenance',
      ].includes(url.pathname)
    )
      return next();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    const send = (status, body) => {
      if (status >= 400) res.setHeader('Cache-Control', 'no-store');
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
      if (fileMatch) {
        const name = fileMatch[1];
        if (!AIRPORT_SOURCE_FILES.includes(name) || !collector.readSourceFile)
          return send(404, { error: 'Airport source file not found' });
        if (q.revision && q.revision !== snapshot.revision)
          return send(409, { error: 'Airport revision changed' });
        let body;
        try {
          body = await collector.readSourceFile(name, {
            revision: snapshot.revision,
          });
        } catch {
          return send(503, { error: 'Airport source file unavailable' });
        }
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.statusCode = 200;
        return res.end(body);
      }
      if (url.pathname.endsWith('/provenance')) {
        const provenance = collector.getProvenance?.() || metadata(snapshot);
        return send(200, {
          ...provenance,
          ...metadata(snapshot),
          files: Object.fromEntries(
            Object.entries(provenance.files || {})
              .filter(([name]) => AIRPORT_SOURCE_FILES.includes(name))
              .map(([name, info]) => [
                name,
                {
                  ...info,
                  url: `/api/airports/files/${name}?revision=${snapshot.revision}`,
                },
              ]),
          ),
        });
      }
      if (url.pathname.endsWith('/countries'))
        return snapshot.countries
          ? send(200, { ...metadata(snapshot), countries: snapshot.countries })
          : send(503, { error: 'Country directory unavailable' });
      if (url.pathname.endsWith('/navaids'))
        return snapshot.navaids
          ? send(200, queryNavaids(snapshot, q))
          : send(503, { error: 'Navaid directory unavailable' });
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
