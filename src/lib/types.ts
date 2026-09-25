export type Mode = 'auto' | 'bicycle' | 'pedestrian'
export type Theme = 'calm' | 'classic' | 'dark'
export type Coordinate = { lat: number; lon: number }
export type Waypoint = { id: string; original: Coordinate; snapped: Coordinate | null }
export type Leg = { index: number; distanceKm: number; coordinates: Coordinate[] }
export type RouteDraft = { mode: Mode; waypoints: Waypoint[] }
export type SavedRoute = RouteDraft & { id: string; name: string; savedAt: string }
export type Asset = { path: string; url: string; bytes: number }
export type MapArea = Asset & { id: string; bbox: [number, number, number, number] }
export type DataManifest = {
  version: string
  bounds: [number, number, number, number]
  areas: MapArea[]
  graph: null | { manifestUrl: string; coverage: [number, number, number, number]; files: Asset[] }
}

export const BAY_CENTER: Coordinate = { lat: 37.7739, lon: -122.4312 }
export const BAY_BOUNDS: [number, number, number, number] = [-123.15, 36.88, -121.38, 38.88]
export const EMPTY_DRAFT: RouteDraft = { mode: 'auto', waypoints: [] }
