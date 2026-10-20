import { createAirportSource } from '../sources/airports/source.js';
import { normalizeAirportName as normalizeName } from '../sources/airports/records.js';
const explicitAirport = (query) =>
  /\b(airport|airfield|aerodrome|heliport)\b|机场|機場|空港/i.test(query);
export function airportPlace(airport) {
  return {
    lat: airport.lat,
    lng: airport.lon,
    name: airport.name,
    label: [airport.name, airport.municipality, airport.country]
      .filter(Boolean)
      .join(', '),
    types: ['airport'],
    exact: true,
    airportId: airport.id,
  };
}
/** Explicit airport intent stays within the local directory, including ambiguity. */
export function createAirportGeocoder({ source = createAirportSource() } = {}) {
  return {
    async geocode(query, { signal } = {}) {
      signal?.throwIfAborted();
      const code = /^[A-Z]{3,4}$/.test(query);
      const explicit = explicitAirport(query);
      const normalized = normalizeName(query);
      if (!code && !explicit && !normalized.includes(' '))
        return { place: null, answered: true };
      try {
        const result = await source.search(query, { limit: 8, signal });
        signal?.throwIfAborted();
        const airports = code
          ? result.airports.filter(
              (a) => a.icaoCode === query || a.iataCode === query,
            )
          : explicit
            ? result.airports
            : result.airports.filter(
                (a) => normalizeName(a.name) === normalized,
              );
        if (!airports.length && !explicit)
          return { place: null, answered: true };
        if (airports.length === 1 && !result.truncated)
          return {
            place: airportPlace(airports[0]),
            answered: true,
            terminal: true,
          };
        return {
          place: null,
          answered: true,
          terminal: true,
          ...(airports.length ? { choices: airports.map(airportPlace) } : {}),
        };
      } catch (error) {
        signal?.throwIfAborted();
        return {
          place: null,
          answered: false,
          ...(code || explicit ? { terminal: true } : {}),
        };
      }
    },
  };
}
