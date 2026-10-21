# Airport directory operations

The project hosts a global OurAirports directory for the Airports map layer,
details and name/ICAO/IATA search, aviation navigation stations and country names.
Source data is public domain:
https://ourairports.com/data/ and https://github.com/davidmegginson/ourairports-data.
Field definitions: https://ourairports.com/help/data-dictionary.html.

## Initial data and storage

The initial snapshot and source provenance live in `server/data/airports/`.
All six original CSV tables are checked into `server/data/airports/raw/`:
`airports.csv`, `countries.csv`, `regions.csv`, `navaids.csv`, `runways.csv` and
`airport-frequencies.csv`. Preserve their original bytes (`.gitattributes` marks
these generated files as non-normalized) so SHA-256 matches the provenance.
The collector seeds a private persistent `raw/<revision>/` archive from this
project bundle using local disk only. A corrupt archive is quarantined and
repaired from validated complete files; a concurrently published valid copy wins.
`node scripts/import-airports.mjs <40-character Git revision> [ISO retrieval time]`
reproduces a snapshot from one pinned upstream revision. Read the bundled
`provenance.json` for its revision and retrieval time before reproducing a release.
Do not edit generated airport rows by hand or use OurAirports identifiers as
inferred ICAO codes. The stable numeric source ID owns record identity.

Configure this server-only setting in `/etc/gods-eye-view.env`:

```dotenv
GEV_AIRPORTS_STATE_DIR=/var/lib/gods-eye-view/airports
```

Create the directory outside the checkout, owned by the `gev` service account,
mode 700. Preserve it on deployment and restart. Data files use mode 600. The
collector publishes validated JSON atomically and retains its daily check
checkpoint across restart. A partial download or invalid update keeps the last
good directory; the bundled version is a fallback. Keep lock/checkpoint files for
diagnosis after a crash rather than deleting them to force a refresh.

- `directory.json`: one atomic envelope containing `snapshot` and `provenance`,
  including the revision, file hashes and snapshot checksum. Records and their
  provenance cannot be partially published as different versions.
- `state.json`: the durable `nextCheckAt` deadline, reserved before an upstream
  attempt. Retry-After can extend it.
- `refresh.lock`: exclusive collection reservation. An interrupted collection
  keeps its daily checkpoint; an expired lock is recovered conservatively.

Readers check the published file version without rereading the entire catalog
on every request. A peer worker sees a newly published version even if it started
while another worker was downloading. Truncated country/region tables are rejected
before publication. State and snapshot files use mode 600, with flushed writes.

## Requests and update behavior

The server checks for changes at most once per day and pins all six upstream
files to one source revision. A complete local revision matching the upstream
SHA requires only the metadata check; CSV downloads are skipped. A new revision
is downloaded and validated as a complete source archive before publishing the
normalized snapshot. Failures keep both last-good data and the project bundle. Browser search, camera movement and airport detail
reads never start an upstream download. Collector retry deadlines also survive
restart. No airport API key, OpenSky credit or ADS-B request allowance is used.

- `/api/airports/provenance`: locally stored version/checksums and same-origin
  links to the six source downloads. The airport card links here, never GitHub.
- `/api/airports/files/<filename>`: validated local CSV download; no upstream
  fetch or redirect. A revision query prevents silently mixing data versions.
- `/api/airports`: bounded viewport points, type filters and honest match/limit
  metadata. A viewport can cross the antimeridian.
- `/api/airports/search?q=EGLL`: ranked directory matches; duplicate codes remain
  separate results for explicit selection.
- `/api/airports/detail?id=2434`: one airport with source/version metadata.
- `/api/airports/navaids`: bounded navigation stations, with viewport bounds,
  `q`, `type` and `limit` filters. Identifiers may be shared by several stations.
- `/api/airports/countries`: the complete country-code/name reference table.

The same pinned revision supplies `airports.csv`, `navaids.csv`, `countries.csv`
and `regions.csv`: 86,258 airport records, 11,008 navaids and 249 country/territory
rows in the initial enriched directory. All records and source checksums publish
in one atomic envelope. The enriched bundle can upgrade an airport-only durable
snapshot of the same revision without another upstream check or changing the
persisted deadline. A newer durable revision is never replaced by older data.

The UI defaults to active facilities and prioritizes large/medium airports from
far away. Closer views admit smaller airfields and heliports. The full directory
also retains closed facilities marked as such. Runways and communication
frequency CSV files are included in the local source archive and download API.

Airport markers use outlined facility/use symbols tinted by the active theme.
Heliports always show a helicopter; seaplane bases and balloonports retain their
own shapes. Fixed-wing facilities distinguish confirmed civil service (airliner),
military classification (fighter), joint use (combined aircraft), and unconfirmed
use (general-airfield aircraft with a question badge). Military/joint-use
helicopters retain the helicopter shape with a usage badge. The layer legend
uses the same SVG symbols and counts only the currently displayed records.

Usage evidence is a bundled, provenance-bearing Wikidata CC0 snapshot joined by
explicit ICAO, audited coordinates and current English Wikipedia article
identity. Known ended/deprecated/dissolved statements and obsolete source items
are excluded; conflicting or incomplete identities fail closed. OurAirports
scheduled service confirms civil service, but does not establish exclusively
civil use. Civil service combined with current, matched airbase evidence is
presented as joint use. Classification/source/check date appear in details; full
evidence and URLs are retained in the entity context and description.

Missing classifications never become military simply because scheduled service
is absent, a facility is small, or its name contains military words. This
supplement is incomplete community evidence, not a global operational registry.
Refresh it deliberately using `scripts/import-airport-usage.mjs` with cached
structured responses and audits; the browser never calls Wikidata. The importer
rejects missing/truncated inputs before replacing the supplemental table. See
`src/sources/airports/usage-data.json` for queries, dates and limitations.

Nearby views also show up to 600 VOR/NDB/DME/TACAN navigation stations with station
symbols and selectable details. The layer row reports limited results. Published
frequencies remain kHz in storage: NDB displays kHz and VHF/DME displays MHz;
nonpositive frequency sentinels display as unknown. Details preserve DME channel,
position and MSL elevation, magnetic and slaved variation, usage, transmitter
power, associated airport and source metadata. Map positions use the terrain
floor. Navigation stations are distinct from broadcast radio and airport
communication-frequency data.

Regional/global views show bounded localized country names using the directory's
ISO table and existing Natural Earth geometry. Largest-landmass anchors, ISO
deduplication and shared collision/horizon handling keep country labels useful.
Zooming in hides country labels and shows local navaids. Disabling Airports
clears both displays.

OurAirports is a community directory, so coverage and individual fields can be
incomplete. Elevation is metres above mean sea level after explicit conversion
from the published feet; it is not an ellipsoid height or live aircraft altitude.
Search names and keywords reflect the actual source; no machine-generated
translations or inferred airport codes are added.

## Deployment checks

Confirm the runtime loads the configured persistent directory, then query both a
known ICAO code (`EGLL`) and IATA code (`LHR`), inspect airport detail and verify the
map layer. Check the returned revision/date and that repeated requests leave the
server's acquisition checkpoint unchanged. Preserve the independent OpenSky and
ADS-B directories and all existing environment credentials.

For an entirely offline rebuild after acquiring the six pinned CSV files, set
`GEV_AIRPORTS_IMPORT_DIR` to their directory before running the importer. The
normal import command downloads upstream only in this server/operator workflow;
no browser airport query performs a download.
