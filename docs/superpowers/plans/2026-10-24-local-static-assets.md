# Local static assets implementation plan

Approved scope: keep the existing fonts and glyphs, download redistributable
static assets during installation, and serve them from the application origin.
Google 3D Tiles, Street View, live feeds and embedded media remain unchanged.

1. Pin font URLs, byte lengths, SHA-256 hashes, glyph inventory and license
   sources in `scripts/static-assets.json`; preserve local font-face rules.
2. Add a bounded, integrity-checked downloader with cache verification and
   fixture tests for cache hits, corruption, invalid responses and failure.
3. Replace Google Fonts HTML links with the local stylesheet; retain every
   requested weight, language subset and icon. Update glyph coverage tests.
4. Invoke preparation before development, production and panel builds, and
   explicitly from the VPS installer before publishing. Ignore downloaded files.
5. Verify same-origin font rendering with Google font hosts blocked, run
   formatting, boundaries, locales, unit tests, production and panel builds.
   Document licenses, disk/bundle cost, install behavior and failure recovery.

No new npm dependencies. Download failures abort deployment before release switch.
Existing complete releases continue serving. Git operations require explicit
authorization under the project rulebook.
