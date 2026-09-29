import { describe, expect, it } from 'vitest'
import { initialLocation, validCoordinate } from './location'

const sensor = { lat: 25.7617, lon: -80.1918 }
const remembered = { lat: 34.0522, lon: -118.2437 }

describe('startup location precedence', () => {
  it('uses sensor coordinates before a remembered location, anywhere in the world', () => {
    expect(initialLocation(sensor, remembered)).toEqual(sensor)
  })
  it('falls back to a remembered location when sensors fail', () => {
    expect(initialLocation(null, remembered)).toEqual(remembered)
  })
  it('requires selection when neither location is available or valid', () => {
    expect(initialLocation(null, undefined)).toBeNull()
    expect(initialLocation({ lat: NaN, lon: 0 }, { lat: 91, lon: 0 })).toBeNull()
  })
  it('rejects malformed stored coordinates without excluding valid non-California locations', () => {
    expect(validCoordinate({ lat: '34', lon: 12 })).toBe(false)
    expect(validCoordinate({ lat: 12, lon: 181 })).toBe(false)
    expect(validCoordinate({ lat: -33.86, lon: 151.21 })).toBe(true)
    expect(validCoordinate({ lat: 0, lon: 0 })).toBe(true)
  })
})
