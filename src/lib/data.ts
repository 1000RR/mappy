import { FileSource, PMTiles } from 'pmtiles'
import { inBounds, intersects, tileBounds } from './geo'
import { assetReady, downloadAsset, getSetting, setSetting, storedFile } from './storage'
import type { Coordinate, DataManifest, MapArea } from './types'

let manifest: DataManifest | null = null
const packages = new Map<string, PMTiles>()
const pending = new Map<string, Promise<void>>()

export function resetData() {
  manifest = null
  packages.clear()
  pending.clear()
}

export async function loadManifest(): Promise<DataManifest> {
  if (manifest) return manifest
  try {
    const response = await fetch('/api/manifest', { cache: 'no-store' })
    if (!response.ok) throw new Error('Map catalog is unavailable')
    manifest = await response.json() as DataManifest
    await setSetting('catalog', manifest)
    return manifest
  } catch (error) {
    const cached = await getSetting<DataManifest>('catalog')
    if (cached) { manifest = cached; return cached }
    throw error
  }
}

export function areaFor(point: Coordinate, catalog: DataManifest): MapArea | undefined {
  return catalog.areas.find((area) => inBounds(point, area.bbox))
}

export async function ensureArea(area: MapArea, onProgress?: (loaded: number) => void, signal?: AbortSignal): Promise<void> {
  if (pending.has(area.id)) return pending.get(area.id)!
  const work = downloadAsset(area, onProgress, signal).finally(() => pending.delete(area.id))
  pending.set(area.id, work)
  await work
  const file = await storedFile(area.path)
  if (!file) throw new Error('Downloaded map could not be opened')
  packages.set(area.id, new PMTiles(new FileSource(file)))
}

export async function loadCachedAreas(catalog: DataManifest): Promise<string[]> {
  const ready: string[] = []
  for (const area of catalog.areas) {
    if (!await assetReady(area)) continue
    const file = await storedFile(area.path)
    if (!file) continue
    packages.set(area.id, new PMTiles(new FileSource(file)))
    ready.push(area.id)
  }
  return ready
}

export async function getMapTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  const catalog = await loadManifest()
  const bounds = tileBounds(z, x, y)
  const candidates = catalog.areas.filter((area) => packages.has(area.id) && intersects(bounds, area.bbox))
  for (const area of candidates) {
    const tile = await packages.get(area.id)!.getZxy(z, x, y, signal)
    if (tile) return tile.data
  }
  return new ArrayBuffer(0)
}

export async function ensureGraph(catalog: DataManifest, onProgress?: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<void> {
  if (!catalog.graph) throw new Error('Offline routing data has not been installed on this server yet.')
  const total = catalog.graph.files.reduce((sum, file) => sum + file.bytes, 0)
  let complete = 0
  for (const file of catalog.graph.files) {
    await downloadAsset(file, (loaded) => onProgress?.(complete + loaded, total), signal)
    complete += file.bytes
    onProgress?.(complete, total)
  }
}

export async function graphReady(catalog: DataManifest): Promise<boolean> {
  if (!catalog.graph) return false
  for (const file of catalog.graph.files) if (!await assetReady(file)) return false
  return true
}
