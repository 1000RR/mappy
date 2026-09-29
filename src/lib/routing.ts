import { Router, RoutingError } from 'valhalla-browser'
import workerUrl from 'valhalla-browser/worker.js?url'
import wasmUrl from 'valhalla-browser/valhalla-browser.wasm?url'
import { decodePolyline6, distanceMeters } from './geo'
import { ensureGraph } from './data'
import type { Coordinate, DataManifest, Leg, Mode, Waypoint } from './types'

let router: Router | null = null
let routerPromise: Promise<Router> | null = null
let downloadController = new AbortController()

async function controlledByServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return
  await navigator.serviceWorker.ready
  if (navigator.serviceWorker.controller) return
  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(resolve, 4000)
    navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(timeout); resolve() }, { once: true })
  })
}

export async function getRouter(catalog: DataManifest, onProgress?: (loaded: number, total: number) => void): Promise<Router> {
  if (router) return router
  routerPromise ??= (async () => {
    await ensureGraph(catalog, onProgress, downloadController.signal)
    await controlledByServiceWorker()
    if (!catalog.graph) throw new Error('Routing data is unavailable')
    const next = new Router({
      manifestUrl: catalog.graph.manifestUrl,
      workerUrl,
      wasmUrl,
      timeoutMs: 30000,
      memoryBudgetBytes: 64 * 1024 * 1024,
      wasmMemory: { initialMiB: 128, maximumMiB: 512 }
    })
    await next.initialize()
    router = next
    return next
  })().finally(() => { routerPromise = null })
  return routerPromise
}

export async function releaseRouter(): Promise<void> {
  downloadController.abort()
  if (routerPromise) await routerPromise.catch(() => undefined)
  if (router) await router.dispose()
  router = null
  routerPromise = null
  downloadController = new AbortController()
}

async function nativeLeg(start: Coordinate, end: Coordinate, mode: Mode, engine: Router) {
  const request = mode === 'auto' ? { origin: start, destination: end, costing: 'auto' as const }
    : mode === 'bicycle' ? { origin: start, destination: end, costing: 'bicycle' as const }
    : { origin: start, destination: end, costing: 'pedestrian' as const }
  const result = await engine.route(request)
  const shape = result.native.trip.legs[0]?.shape
  if (!shape) throw new Error('No route could be found between these points.')
  const coordinates = decodePolyline6(shape)
  if (coordinates.length < 2) throw new Error('No route could be found between these points.')
  return { coordinates, distanceKm: result.native.trip.summary.length }
}

export async function snapPoint(point: Coordinate, mode: Mode, engine: Router): Promise<Coordinate> {
  // This browser build exposes routing, but not Valhalla's locate endpoint. A nearby
  // probe asks the same correlator to return the point at the start of a short route.
  const probes: Coordinate[] = [
    { lat: point.lat + 0.0006, lon: point.lon },
    { lat: point.lat, lon: point.lon + 0.0008 },
    { lat: point.lat - 0.0006, lon: point.lon },
    { lat: point.lat, lon: point.lon - 0.0008 }
  ]
  for (const probe of probes) {
    try {
      const leg = await nativeLeg(point, probe, mode, engine)
      const snapped = leg.coordinates[0]
      if (distanceMeters(point, snapped) <= 200) return snapped
    } catch (error) {
      if (error instanceof RoutingError && ['NETWORK', 'DATASET', 'INCOMPLETE_DATASET', 'RUNTIME'].includes(error.code)) throw error
    }
  }
  throw new Error('No usable road or path within 200 metres. Try a point closer to a mapped route.')
}

export async function snapWaypoints(waypoints: Waypoint[], mode: Mode, engine: Router): Promise<Waypoint[]> {
  const result: Waypoint[] = []
  for (const waypoint of waypoints) result.push({ ...waypoint, snapped: await snapPoint(waypoint.original, mode, engine) })
  return result
}

export async function calculateLegs(waypoints: Waypoint[], mode: Mode, engine: Router): Promise<Leg[]> {
  const legs: Leg[] = []
  for (let index = 0; index < waypoints.length - 1; index++) {
    const start = waypoints[index].snapped
    const end = waypoints[index + 1].snapped
    if (!start || !end) continue
    legs.push(await calculateLeg(waypoints[index], waypoints[index + 1], index, mode, engine))
  }
  return legs
}

export async function calculateLeg(start: Waypoint, end: Waypoint, index: number, mode: Mode, engine: Router): Promise<Leg> {
  if (!start.snapped || !end.snapped) throw new Error('A waypoint has not been snapped to a road or path.')
  return { index, ...await nativeLeg(start.snapped, end.snapped, mode, engine) }
}
