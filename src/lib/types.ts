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
  bounds: [number, number, number, number] | null
  areas: MapArea[]
  graph: null | { manifestUrl: string; coverage: [number, number, number, number]; files: Asset[] }
}

export const EMPTY_DRAFT: RouteDraft = { mode: 'auto', waypoints: [] }

export type RoutePreview = {
  kind: 'insert' | 'move'
  waypointIndex: number
  waypoint: Waypoint
  legs: Leg[] | null
  pending: boolean
  error: string | null
}
