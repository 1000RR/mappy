import { describe, expect, it } from 'vitest'
import { distanceMeters, inBounds, intersects, tileBounds } from './geo'
import { BAY_BOUNDS, BAY_CENTER } from './types'

describe('Bay Area coverage', () => {
  it('accepts the Bay center and rejects points beyond the data boundary', () => {
    expect(inBounds(BAY_CENTER, BAY_BOUNDS)).toBe(true)
    expect(inBounds({ lat: 40.1, lon: -122.4 }, BAY_BOUNDS)).toBe(false)
  })

  it('finds tiles touching an offline area', () => {
    expect(intersects(tileBounds(11, 327, 791), BAY_BOUNDS)).toBe(true)
    expect(intersects(tileBounds(11, 1000, 791), BAY_BOUNDS)).toBe(false)
  })

  it('measures the 200 metre snap limit in metres', () => {
    const near = { ...BAY_CENTER, lat: BAY_CENTER.lat + 0.001 }
    const far = { ...BAY_CENTER, lat: BAY_CENTER.lat + 0.003 }
    expect(distanceMeters(BAY_CENTER, near)).toBeLessThan(200)
    expect(distanceMeters(BAY_CENTER, far)).toBeGreaterThan(200)
  })
})
