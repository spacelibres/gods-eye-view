# Airport directory operations

The project hosts a global OurAirports directory for the Airports map layer,
details and name/ICAO/IATA search. Source data is public domain:
https://ourairports.com/data/ and https://github.com/davidmegginson/ourairports-data.
Field definitions: https://ourairports.com/help/data-dictionary.html.

## Initial data and storage

The initial snapshot and source provenance live in `server/data/airports/`.
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

The server checks for changes at most once per day and pins related upstream
files to one source revision. Browser search, camera movement and airport detail
reads never start an upstream download. Collector retry deadlines also survive
restart. No airport API key, OpenSky credit or ADS-B request allowance is used.

- `/api/airports`: bounded viewport points, type filters and honest match/limit
  metadata. A viewport can cross the antimeridian.
- `/api/airports/search?q=EGLL`: ranked directory matches; duplicate codes remain
  separate results for explicit selection.
- `/api/airports/detail?id=2434`: one airport with source/version metadata.

The UI defaults to active facilities and prioritizes large/medium airports from
far away. Closer views admit smaller airfields and heliports. The full directory
also retains closed facilities marked as such. Runways and communication
frequencies are not included in this feature.

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
