import { describe, expect, it } from 'vitest'
import { distanceMeters, inBounds, intersects, tileBounds } from './geo'
const areaBounds: [number, number, number, number] = [-123.15, 36.88, -121.38, 38.88]
const areaCenter = { lat: 37.7739, lon: -122.4312 }

describe('Area coverage', () => {
  it('accepts an area center and rejects points beyond the data boundary', () => {
    expect(inBounds(areaCenter, areaBounds)).toBe(true)
    expect(inBounds({ lat: 40.1, lon: -122.4 }, areaBounds)).toBe(false)
  })

  it('finds tiles touching an offline area', () => {
    expect(intersects(tileBounds(11, 327, 791), areaBounds)).toBe(true)
    expect(intersects(tileBounds(11, 1000, 791), areaBounds)).toBe(false)
  })

  it('measures the 200 metre snap limit in metres', () => {
    const near = { ...areaCenter, lat: areaCenter.lat + 0.001 }
    const far = { ...areaCenter, lat: areaCenter.lat + 0.003 }
    expect(distanceMeters(areaCenter, near)).toBeLessThan(200)
    expect(distanceMeters(areaCenter, far)).toBeGreaterThan(200)
  })
})
