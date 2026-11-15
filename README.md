# Intimidation-Tactics

Client-side Magic: The Gathering deck builder using React, TypeScript, Vite,
Zustand and IndexedDB. No application backend is required. Card/deck data is
stored in the visitor's browser. AI providers are optional.

## Build and verify

Use a supported Node.js LTS release (22.x or 24.x) and npm.

    npm ci --ignore-scripts
    npm test -- --maxWorkers=2
    npm run lint
    npm run typecheck
    npm run build
    node --test tests/deployment.test.mjs

The final command requires a completed build. No CI workflow is currently
included; these commands must pass before release.

## Deploy

Upload only the contents of `dist/` to an HTTPS static host at the origin root.
Do not upload this repository, `node_modules/`, `src/`, tests or `.hermes/`.
Production needs no Node or Python server and no server-side API keys.

Serve JavaScript, CSS, JSON, PNG and the web manifest with their appropriate MIME
types. Serve `index.html`, `manifest.webmanifest` and `sw.js` with revalidation
(e.g. Cache-Control: no-cache); hashed files under `assets/` may use long-lived
immutable caching. Keep old hashed assets available during a rolling update.

Root-path hosting is the supported deployment shape. Subpath hosting, including
GitHub Pages project URLs, requires a separate URL/service-worker compatibility
change; changing Vite's base alone is insufficient.

Open the deployed URL, load the card database from Scryfall or a local file, and
verify search, deck editing, import/export and the service worker. Optional AI
providers require their own reachable endpoints and browser CORS permission.
Do not provide real credentials as part of a release smoke test.

## Repository boundaries

Source, tests, fixtures, build configuration and snapshot-maintenance scripts are
tracked so releases can be reproduced. Only `dist/` is deployed.

All new plans belong in `/.hermes/plans/`. Local planning history, diagnostic
reports and one-off outputs belong in `/.hermes/archive/` or another directory
under `/.hermes/`. The entire workspace is Git-ignored. Ignoring a path does not
untrack previously committed files; remove those explicitly from the index.

Bundled snapshots under `src/data/` are application inputs, not stale outputs.
The maintenance command `npm run refresh-meta` is optional and performs network
requests; it is not part of installation, tests or deployment.

## License and attribution

GNU GPL v3.0; see LICENSE. Keep LICENSE with distributed builds and retain the
source and other notices required by the license.

Intimidation-Tactics is unofficial Fan Content permitted under the Fan Content
Policy. Not approved/endorsed by Wizards. Portions of the materials used are
property of Wizards of the Coast. ©Wizards of the Coast LLC.
