# Worldwide coverage design

Status: design for the next data-system milestone. The running app currently serves a prebuilt Bay Area catalog and graph.

## Decisions

- Cover locations worldwide where OpenStreetMap data is available.
- Keep one fixed global grid. Center the map view on the searched, saved, or current location; do not shift cell boundaries for each address.
- Cap downloaded **map squares** at 150 MB on the device. Routing graph packages have a separate storage policy and must show their size before download.
- Keep routing graphs under a separately configurable device limit, evicting older unused graph packages when needed.
- Fetch worldwide OSM and vector-map source extracts server-to-server on demand. The upstream source sees a coarse area request from the NestJS server, not the user's IP or exact waypoint.
- The browser sends coarse grid cell IDs and address queries to the self-hosted NestJS service. Exact waypoints and route geometry stay on the device.

## Grid and loading

Use a fixed 30 km Web Mercator grid with stable `(column,row)` IDs and half-open cell bounds. At Bay Area latitude a cell is roughly 15 ground miles wide; physical size varies with latitude. Web Mercator cannot cover the poles. The fixed grid avoids gaps, offsets, and ambiguous ownership: a point exactly on a boundary belongs to the cell returned by the same `floor` rule everywhere.

Download a cell when it enters the visible viewport or a planned route corridor. Prefetch one cell ahead when movement or the active route points toward an edge and storage permits. At an exact corner, four cells meet. Fetch all four if the viewport sees all four; for a known diagonal path fetch cells intersected by a buffered route corridor. The two orthogonal neighbors are useful when a road detours through them or the user's direction is uncertain, but should not be fetched solely because a diagonal cell was entered.

NestJS should expose a versioned cell catalog and jobs that extract PMTiles from an upstream planet-scale vector source, then publish complete files atomically. The source fetch happens server-to-server and uses the coarse cell bounds. The browser should show queued, extracting, publishing, downloading, and ready states. A map square request is keyed by its cell ID, so jobs can be deduplicated and cached. The service should avoid logging IP-to-cell and address-query histories.

Store map files in OPFS and access time, byte size, version, and pin state in IndexedDB. Before each download, make room within the 150 MB map budget by evicting least recently used distant squares. Protect squares visible now, needed by the active route, or being downloaded. Verify the finished file before marking it ready; interrupted downloads remain retryable. If one square exceeds the budget, report that constraint instead of evicting endlessly.

## Routing and search

Routing graphs cannot be treated as independent 15-mile map squares with the current single-graph Valhalla browser runtime. A route needs one graph covering its stops and plausible detours. Fetch a regional OSM source extract server-to-server, build or select a buffered graph based on coarse cell IDs, publish it as a versioned archive, show server build progress, and download it separately from the map budget. Keep the existing route visible while a replacement graph is prepared. Evict older graph packages under a separately configurable limit, protecting the active graph and saved offline routes. A graph change may require revalidating affected legs; a travel-mode change still reroutes every leg.

The current 497 MB Bay Area graph shows why a 150 MB combined map-and-routing cap is not feasible with this graph format. Regional graph size and browser memory must be tested before promising arbitrary long routes on phones. Worldwide address search also requires replacing the Bay-only index with a self-hosted global or regional geocoder.

## Delivery sequence

1. Add fixed-grid math, boundary/corner tests, device map-cache accounting, and 150 MB eviction.
2. Add NestJS map-cell jobs, progress events, and a source for worldwide vector data.
3. Add regional OSM graph build jobs, versioned graph selection, progress, and safe graph switching.
4. Expand address search and test Florida, cross-cell routes, interrupted downloads, offline reopening, and physical iPhone/Android storage limits.
