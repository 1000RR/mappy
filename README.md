# Mappy

A private, offline-ready Bay Area route planner. React and MapLibre run in the browser; NestJS serves the app, map packages, and address search. Route coordinates are handled locally by `valhalla-browser`.

## Run locally

Requires Node 24+, npm, and local map/routing/search data (see below).

```sh
npm install
npm run dev:server
```

In a second terminal:

```sh
npm run dev
```

Open `http://localhost:5173`. The development app works before data is installed, but route calculation and the basemap require the data packages. Run `npm run build && npm start` to serve the built PWA from NestJS on port 3001. Use HTTPS outside localhost for browser location and offline storage.

## Build data

1. Download a Protomaps basemap PMTiles build from [the published builds](https://maps.protomaps.com/builds), or create one from OpenStreetMap. Do not use the public `tile.openstreetmap.org` service for area downloads.
2. Install the [PMTiles CLI](https://docs.protomaps.com/pmtiles/cli), then generate approximately 15-mile Bay Area packages:

   ```sh
   PMTILES_SOURCE=/path/to/source.pmtiles npm run data:maps
   ```

   To build one area while testing, set `ONLY_CELL=bay-r4-c2` (or another grid ID). Remove `ONLY_CELL` for the Bay Area release.
3. Build a matching Bay Area Valhalla graph with the [pinned `valhalla-wasm` data pipeline](https://github.com/tobilg/valhalla-wasm/blob/main/docs/building-graph-data.md). Its dataset release contains `manifest.json`, `config.json`, and `graph.tar`. Import it, then regenerate the app manifest:

   ```sh
   node scripts/import-graph.mjs /path/to/valhalla-wasm/public/datasets/RELEASE
   PMTILES_SOURCE=/path/to/source.pmtiles npm run data:maps
   ```

   The SDK pins a specific Valhalla graph format; using a graph built by an unrelated Valhalla version can fail. Use an OSM extract larger than the intended route area to allow detours near the edge.
4. Build the local Bay Area address index from an OSM GeoJSONSeq extract:

   ```sh
   npm run data:search -- /path/to/bay-area.geojsonseq
   ```

   NestJS serves `/api/search` from `data/search.sqlite`. A private [Photon](https://github.com/komoot/photon) instance is optional: set `PHOTON_URL` to its internal URL to use it first, with the local index as fallback.
5. Copy Protomaps [basemap font and sprite assets](https://github.com/protomaps/basemaps-assets) under `public/fonts/` and `public/sprites/v4/`. This keeps label and icon requests on the app's own origin, including offline.

Large generated data files are ignored by Git. Deploy `data/`, `dist/`, and `dist-server/` together. NestJS serves range requests for graph files and map packages. Turn off HTTP request logging at the edge so IP-to-area and address-search histories are not retained. The current Bay graph is about 474 MiB; browsers need enough free device storage to save it. The graph build reports missing country assignments, so travel behavior near administrative boundaries needs further validation.

## Privacy and storage

The browser saves routes, drafts, last location, and style in IndexedDB; full map packages and graph files in the Origin Private File System; and the app shell in Cache Storage. The service worker answers Valhalla graph range requests from local files when offline. No waypoint or route API is exposed by NestJS. Address searches reach the self-hosted NestJS service, which uses the local SQLite index unless private Photon is configured.

Use **Privacy & storage → Clear all app data** to delete local routes, location, preferences, downloaded data, and offline caches. Browser location permission must be revoked in browser settings.

## Validation

`npm run typecheck`, `npm test`, and `npm run build` verify code. A Bay Area graph, 70 map areas, and the address index have been built locally. A release still requires airplane-mode checks in desktop browsers and physical iPhone and Android browsers for all three travel modes.
