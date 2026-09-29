import { describe, expect, it, vi } from 'vitest'
import { updateLegsIncrementally } from './legs'
import type { Leg, Waypoint } from './types'

const point = (id: string, lon: number): Waypoint => ({ id, original: { lat: 37, lon }, snapped: { lat: 37, lon } })
const edge = (start: Waypoint, end: Waypoint, index: number): Leg => ({ index, distanceKm: 1, coordinates: [start.snapped!, end.snapped!] })
const route = vi.fn(async (start: Waypoint, end: Waypoint, index: number) => edge(start, end, index))

describe('incremental route edits', () => {
  const a = point('a', -122.1), b = point('b', -122.2), c = point('c', -122.3), d = point('d', -122.4)

  it('routes only the new edge when appending', async () => {
    route.mockClear()
    const old = [edge(a, b, 0), edge(b, c, 1)]
    const result = await updateLegsIncrementally([a, b, c], old, [a, b, c, d], route)
    expect(route).toHaveBeenCalledTimes(1)
    expect(route).toHaveBeenCalledWith(c, d, 2)
    expect(result[0].coordinates).toBe(old[0].coordinates)
    expect(result[1].coordinates).toBe(old[1].coordinates)
  })

  it('routes only the two edges around an inserted point', async () => {
    route.mockClear()
    const x = point('x', -122.25)
    const result = await updateLegsIncrementally([a, b, c], [edge(a, b, 0), edge(b, c, 1)], [a, b, x, c], route)
    expect(route).toHaveBeenCalledTimes(2)
    expect(result.map((leg) => leg.index)).toEqual([0, 1, 2])
  })

  it('routes only the bridge after removing a middle point', async () => {
    route.mockClear()
    const old = [edge(a, b, 0), edge(b, c, 1), edge(c, d, 2)]
    const result = await updateLegsIncrementally([a, b, c, d], old, [a, c, d], route)
    expect(route).toHaveBeenCalledTimes(1)
    expect(route).toHaveBeenCalledWith(a, c, 0)
    expect(result[1].coordinates).toBe(old[2].coordinates)
    expect(result[1].index).toBe(1)
  })

  it('routes only adjoining edges after moving a point', async () => {
    route.mockClear()
    const moved = { ...b, snapped: { lat: 37.001, lon: b.snapped!.lon } }
    await updateLegsIncrementally([a, b, c, d], [edge(a, b, 0), edge(b, c, 1), edge(c, d, 2)], [a, moved, c, d], route)
    expect(route).toHaveBeenCalledTimes(2)
  })

  it.each([0, 2])('routes only one adjoining edge when dragging endpoint %i', async (index) => {
    route.mockClear()
    const oldPoints = [a, b, c]
    const oldLegs = [edge(a, b, 0), edge(b, c, 1)]
    const next = oldPoints.map((waypoint, at) => at === index ? { ...waypoint, snapped: { lat: 37.001, lon: waypoint.snapped!.lon } } : waypoint)
    const result = await updateLegsIncrementally(oldPoints, oldLegs, next, route)
    expect(route).toHaveBeenCalledTimes(1)
    const unchanged = index === 0 ? 1 : 0
    expect(result[unchanged].coordinates).toBe(oldLegs[unchanged].coordinates)
    expect(next[index].id).toBe(oldPoints[index].id)
  })

  it('drops an endpoint without calling the router', async () => {
    route.mockClear()
    const old = [edge(a, b, 0), edge(b, c, 1)]
    const result = await updateLegsIncrementally([a, b, c], old, [b, c], route)
    expect(route).not.toHaveBeenCalled()
    expect(result[0].coordinates).toBe(old[1].coordinates)
    expect(result[0].index).toBe(0)
  })

  it('routes only changed edges after reordering adjacent stops', async () => {
    route.mockClear()
    const old = [edge(a, b, 0), edge(b, c, 1), edge(c, d, 2)]
    const result = await updateLegsIncrementally([a, b, c, d], old, [a, c, b, d], route)
    expect(route).toHaveBeenCalledTimes(3)
    expect(result.map((leg) => leg.index)).toEqual([0, 1, 2])
  })
})
