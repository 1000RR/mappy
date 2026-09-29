import type { Leg, Waypoint } from './types'

function edgeKey(start: Waypoint, end: Waypoint): string {
  return JSON.stringify([start.id, start.snapped, end.id, end.snapped])
}

/** Reuse unchanged legs and route only edges introduced by an edit. */
export async function updateLegsIncrementally(
  previousPoints: Waypoint[],
  previousLegs: Leg[],
  nextPoints: Waypoint[],
  routeEdge: (start: Waypoint, end: Waypoint, index: number) => Promise<Leg>
): Promise<Leg[]> {
  const reusable = new Map<string, Leg>()
  if (previousLegs.length === Math.max(0, previousPoints.length - 1)) {
    for (const leg of previousLegs) {
      const start = previousPoints[leg.index]
      const end = previousPoints[leg.index + 1]
      if (start?.snapped && end?.snapped) reusable.set(edgeKey(start, end), leg)
    }
  }
  const next: Leg[] = []
  for (let index = 0; index < nextPoints.length - 1; index++) {
    const start = nextPoints[index]
    const end = nextPoints[index + 1]
    if (!start.snapped || !end.snapped) continue
    const existing = reusable.get(edgeKey(start, end))
    next.push(existing ? { ...existing, index } : await routeEdge(start, end, index))
  }
  return next
}
