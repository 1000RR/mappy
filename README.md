# Mappy

A private, offline-ready route planner. The currently installed data covers the Bay Area. React and MapLibre run in the browser; NestJS serves the app, map packages, and address search. Route coordinates are handled locally by `valhalla-browser`.

The [worldwide coverage design](docs/worldwide-coverage.md) describes fixed map squares, the 150 MB map cache, and on-demand regional routing. Those data services are not yet part of the running Bay Area app.

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
2. Install the [PMTiles CLI](https://docs.protomaps.com/pmtiles/cli), then generate approximately 15-mile packages for your area:

   ```sh
   AREA_BOUNDS='-123.15,36.88,-121.38,38.88' PMTILES_SOURCE=/path/to/source.pmtiles npm run data:maps
   ```

   Set `AREA_BOUNDS=west,south,east,north` for any region; omission reuses the installed manifest bounds. Package IDs include a bounds hash so different regions do not reuse each other’s files. `ONLY_CELL=area-HASH-r4-c2` builds a single grid cell. This extraction tool still uses a region-relative grid; the worldwide fixed grid remains future work.
3. Build a matching regional Valhalla graph with the [pinned `valhalla-wasm` data pipeline](https://github.com/tobilg/valhalla-wasm/blob/main/docs/building-graph-data.md). Its dataset release contains `manifest.json`, `config.json`, and `graph.tar`. Import it, then regenerate the app manifest:

   ```sh
   node scripts/import-graph.mjs /path/to/valhalla-wasm/public/datasets/RELEASE
   PMTILES_SOURCE=/path/to/source.pmtiles npm run data:maps
   ```

   The SDK pins a specific Valhalla graph format; using a graph built by an unrelated Valhalla version can fail. Use an OSM extract larger than the intended route area to allow detours near the edge.
4. Build the local address/ZIP index from an OSM GeoJSONSeq extract:

   ```sh
   npm run data:search -- /path/to/area.geojsonseq
   ```

   NestJS serves `/api/search` from `data/search.sqlite`. A private [Photon](https://github.com/komoot/photon) instance is optional: set `PHOTON_URL` to its internal URL to use it first, with the local index as fallback.
5. Copy Protomaps [basemap font and sprite assets](https://github.com/protomaps/basemaps-assets) under `public/fonts/` and `public/sprites/v4/`. This keeps label and icon requests on the app's own origin, including offline.

Large generated data files are ignored by Git. Deploy `data/`, `dist/`, and `dist-server/` together. NestJS serves range requests for graph files and map packages. Turn off HTTP request logging at the edge so IP-to-area and address-search histories are not retained. The current Bay graph is about 474 MiB; browsers need enough free device storage to save it. The graph build reports missing country assignments, so travel behavior near administrative boundaries needs further validation.

## Privacy and storage

The browser saves routes, drafts, last location, and style in IndexedDB; full map packages and graph files in the Origin Private File System; and the app shell in Cache Storage. The service worker answers Valhalla graph range requests from local files when offline. No waypoint or route API is exposed by NestJS. Address searches reach the self-hosted NestJS service, which uses the local SQLite index unless private Photon is configured.

Use **Privacy & storage → Clear all app data** to delete local routes, location, preferences, downloaded data, and offline caches. Browser location permission must be revoked in browser settings.

## Validation

`npm run typecheck`, `npm test`, and `npm run build` verify code. A Bay Area graph, 70 map areas, and the address index have been built locally. A release still requires airplane-mode checks in desktop browsers and physical iPhone and Android browsers for all three travel modes.

## Starting location

Startup waits up to seven seconds for browser/device location, then uses the last valid location stored in IndexedDB. If neither exists, a modal with a 50% gray backdrop offers ten California cities and **Other** for address/ZIP search. The **Choose starting area** map control reopens it. Location choices and search results are remembered locally.

Available map packages and a matching routing graph are downloaded automatically, with progress. Coverage comes from `data/manifest.json`; runtime coordinates and search have no Bay Area restriction. Missing packages are reported explicitly: automatic worldwide extraction/build jobs are still not implemented. The local search index covers only its imported extract; rebuild it to include postcode tags, or configure private `PHOTON_URL` with the desired coverage. There is no public geocoder fallback.

## Editing a route

Click to append a stop. Drag an existing route segment to create a full intermediate waypoint: the pin follows your pointer, snaps within 200 metres, and the two affected routed legs preview as animated blue dashes. Release to keep it; Escape or an invalid release preserves the original route. Only those two legs are recalculated, queued pointer positions are coalesced, and the whole drag is one Undo action. Right-click a route to insert through the menu, or a waypoint to remove it.

Dragging an existing waypoint uses the same live routed preview and animated dashed lines. Only the attached legs change (one for an endpoint, two for a middle stop); the waypoint keeps its identity and position in the list. Release commits one undoable move. Escape or an invalid drop restores its previous position.
