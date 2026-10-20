# Global airport database integration — draft design

Status: approved on 2026-10-21 by the user's selection of map layer plus
airport name/ICAO/IATA search and navigation. Runways and communication frequencies
are outside this implementation. This is the target design, not a deployment log.

## Goal and scope

Load a global airport directory into God's Eye View using data hosted by the
project, without per-browser requests to an external airport service. Recommended
initial scope: a switchable airport layer, airport details, and search/navigation
by name, explicit ICAO code or IATA code. The shared directory should remain usable
by later flight enrichment and voice queries.

The selected scope includes map, search and airport details. Runway geometry,
communication frequencies, navigation aids and unrelated community comments are
excluded. No operational runway or frequency data is inferred.

## Verified source

Use OurAirports, whose published data is public domain and generated daily:

- https://ourairports.com/data/
- https://github.com/davidmegginson/ourairports-data
- https://ourairports.com/help/data-dictionary.html

A read-only fetch on 2026-10-21 returned 86,258 airport records in a 12,748,669-byte
CSV (3,797,621 bytes when locally gzip-compressed). This includes 13,574 closed
facilities, 23,248 heliports, 42,820 small airports, 4,104 medium airports, 1,176
large airports, 1,273 seaplane bases and 63 balloonports. These are observed
snapshot counts, not permanent assertions or a guarantee of complete coverage.

Import airports, countries and regions. Runways and airport-frequencies depend on
the selected scope. Do not import community comments or unrelated navigation-aid
tables for the initial feature. Preserve attribution and the dataset revision.

## Alternatives

1. **VPS directory with a bundled fallback — recommended.** Ship a reproducible
   initial snapshot; serve validated updates from the VPS. Browsers receive only
   the requested search results, viewport points and airport details. This keeps
   browser startup small and avoids external request quotas.
2. **Bundled static directory only.** Simple and works without an airport backend,
   but refreshing the database requires another release. The initial catalog must
   still be loaded lazily rather than embedded in the startup JavaScript bundle.
3. **Browser requests to a hosted airport API.** Requires an external dependency
   for every client and can introduce keys, quotas and variable availability;
   unsuitable for the user's existing preference for self-hosted data.

## Data model and correctness

Use the persistent numeric OurAirports `id` for identity. Keep `ident`,
`icao_code`, `iata_code`, `gps_code` and `local_code` as distinct fields. An
OurAirports identifier is not automatically an ICAO code. Ambiguous code matches
must produce a choice rather than silently overwrite another airport.

Preserve names, municipality, country/region codes and names, facility type,
scheduled-service flag, optional elevation and source links. Validate finite
longitude/latitude and their bounds; reject invalid coordinates and duplicate
primary IDs. Do not turn empty coordinates into zero or treat country code `NA`
(Namibia) as a null value. Elevation is published in feet above mean sea level;
convert units explicitly and never pass it as an ellipsoid height.

Unknown or absent values stay unknown. Retain closed facilities in the directory
and mark them closed. Hide them from the default active-facility map view. Do not
infer military ownership, current operational status or commercial service from
an airport name. Dataset coverage is community-maintained, not an official
operational aviation publication.

## Acquisition and persistence

Follow the existing server-provider lifecycle and shared-cache pattern. Keep
airport data in `GEV_AIRPORTS_STATE_DIR`, deployed as
`/var/lib/gods-eye-view/airports`, outside the checkout and owned by `gev`.

Publish one validated version containing records, source revision, retrieval time,
schema version, counts and checksum. Build memory indexes for IDs, codes, names
and spatial cells after validation. JSON snapshots are sufficient for this data
volume; a new database service is unnecessary for the initial feature.

Check for upstream changes at most once per day from the server; do not add a
desktop automation. Persist the next-check deadline, coalesce collection across
workers, honor HTTP retry deadlines and bound transfer/body size and duration.
Fetch related files at one pinned source revision. Publish with atomic replacement
only after all required files validate. A partial download, upstream failure,
corrupt update or unexpected schema must retain the last good directory. A
restart or deployment must preserve records and the refresh deadline. The bundled
snapshot remains a usable fallback with its actual revision visible.

## Application integration

Expose a project-owned directory adapter with bounded operations for searching,
reading airport details and selecting facilities for a viewport. The standalone
adapter uses same-origin server routes. Keep data acquisition separate from the
layer and Cesium rendering, consistent with sourceComposition and constructCatalog.

For the recommended UI scope:

- Add a switchable Airports layer through the existing catalog and source
  contracts. Use the next free immutable layer token; never repurpose a token.
- At world scale, prioritize large/medium airports; reveal smaller facilities
  as the camera approaches. Bound rendered points and labels, use the existing
  world-overlay selection path, and report any selection limit honestly.
- Details show the source name, facility type/status, codes, country/city,
  coordinates and optional elevation. Use existing safe text rendering for
  upstream names and links.
- Support exact ICAO/IATA search and name matches through existing place-search
  navigation. Do not hijack ordinary city/address queries. Chinese airport-name
  support depends on actual source aliases; do not claim a translated directory
  or fabricate aliases.
- Use the existing spacelibre palette roles, typography, approved SVG logo and
  panel interactions. Add no independent color system or replacement branding.
- Lazy-load directory data, coalesce repeated reads, cache by published revision,
  and cancel superseded viewport/search requests without canceling shared server
  collection. A malformed response is an error, never a healthy empty catalog.

The daily directory has a different update cadence from live aircraft snapshots.
It must not consume OpenSky credits or modify existing ADS-B collection budgets.

## Verification and delivery

Tests must cover CSV quoting/Unicode, missing fields, Namibia, invalid coordinates,
stable IDs, distinct code fields, duplicate-code ambiguity, closed/type filtering,
antimeridian viewports, response limits, coalescing, restart persistence, atomic
update failure and last-good fallback. Test airport-code/name navigation while
ordinary place queries retain their existing behavior.

If UI is selected, verify map switching, viewport detail levels, labels, details,
search-to-camera navigation, share links, mobile layout and alternate themes in
a real browser. Run the applicable focused suite, build, formatting, boundaries,
i18n, immutable-token check, full units and tracking regression. Report existing
baseline failures separately rather than claiming a clean full suite.

After a verified implementation milestone, increment the patch version, commit
and push to GitHub. Deploy to the authorized VPS and verify same-origin airport
queries, persistent directory ownership, source revision and repeated client
reads causing no additional upstream acquisition.
