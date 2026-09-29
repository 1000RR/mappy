import type { Coordinate } from './types'

export const popularAreas: Array<{ name: string; point: Coordinate }> = [
  { name: 'San Francisco', point: { lat: 37.7749, lon: -122.4194 } },
  { name: 'Los Angeles', point: { lat: 34.0522, lon: -118.2437 } },
  { name: 'San Diego', point: { lat: 32.7157, lon: -117.1611 } },
  { name: 'San Jose', point: { lat: 37.3382, lon: -121.8863 } },
  { name: 'Sacramento', point: { lat: 38.5816, lon: -121.4944 } },
  { name: 'Oakland', point: { lat: 37.8044, lon: -122.2712 } },
  { name: 'Santa Barbara', point: { lat: 34.4208, lon: -119.6982 } },
  { name: 'Monterey', point: { lat: 36.6002, lon: -121.8947 } },
  { name: 'Palm Springs', point: { lat: 33.8303, lon: -116.5453 } },
  { name: 'South Lake Tahoe', point: { lat: 38.9399, lon: -119.9772 } }
]

export function validCoordinate(point: unknown): point is Coordinate {
  if (!point || typeof point !== 'object') return false
  const { lat, lon } = point as Coordinate
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
}

export function initialLocation(current: unknown, remembered: unknown): Coordinate | null {
  return validCoordinate(current) ? current : validCoordinate(remembered) ? remembered : null
}

export type SearchResult = Coordinate & { name: string; detail: string }
export async function searchAddresses(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const response = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, { signal })
  if (!response.ok) throw new Error('Address search is unavailable. Try again when connected to the server.')
  const data = await response.json() as { results: SearchResult[] }
  return data.results.filter(validCoordinate)
}
