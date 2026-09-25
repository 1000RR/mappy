import type { Coordinate } from './types'

export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const r = 6371008.8
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLon = (b.lon - a.lon) * Math.PI / 180
  const lat1 = a.lat * Math.PI / 180
  const lat2 = b.lat * Math.PI / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

export function inBounds(point: Coordinate, bbox: [number, number, number, number]): boolean {
  return point.lon >= bbox[0] && point.lon <= bbox[2] && point.lat >= bbox[1] && point.lat <= bbox[3]
}

export function intersects(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}

export function tileBounds(z: number, x: number, y: number): [number, number, number, number] {
  const lon = (tileX: number) => tileX / 2 ** z * 360 - 180
  const lat = (tileY: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * tileY / 2 ** z))) * 180 / Math.PI
  return [lon(x), lat(y + 1), lon(x + 1), lat(y)]
}

export function decodePolyline6(encoded: string): Coordinate[] {
  const points: Coordinate[] = []
  let lat = 0
  let lon = 0
  let index = 0
  while (index < encoded.length) {
    const values: number[] = []
    for (let axis = 0; axis < 2; axis++) {
      let result = 0
      let shift = 0
      let byte: number
      do {
        byte = encoded.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20 && index < encoded.length)
      values.push(result & 1 ? ~(result >> 1) : result >> 1)
    }
    lat += values[0]
    lon += values[1]
    points.push({ lat: lat / 1e6, lon: lon / 1e6 })
  }
  return points
}

export function formatDistance(km: number): string {
  const miles = km * 0.621371
  return miles < 0.1 ? `${Math.round(miles * 5280)} ft` : `${miles.toFixed(miles < 10 ? 1 : 0)} mi`
}
