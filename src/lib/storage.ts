import { openDB, deleteDB, type IDBPDatabase } from 'idb'
import type { Asset, Coordinate, RouteDraft, SavedRoute, Theme } from './types'

const dbName = 'mappy-state'
let database: Promise<IDBPDatabase> | null = null

function db() {
  database ??= openDB(dbName, 1, {
    upgrade(database) {
      database.createObjectStore('settings')
      database.createObjectStore('routes', { keyPath: 'id' })
    }
  })
  return database
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await db()).get('settings', key) as Promise<T | undefined>
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await (await db()).put('settings', value, key)
}

export const getLastLocation = () => getSetting<{ point: Coordinate; savedAt: string }>('lastLocation')
export const setLastLocation = (point: Coordinate) => setSetting('lastLocation', { point, savedAt: new Date().toISOString() })
export const getDraft = () => getSetting<RouteDraft>('draft')
export const setDraft = (draft: RouteDraft) => setSetting('draft', draft)
export const getTheme = () => getSetting<Theme>('theme')
export const setTheme = (theme: Theme) => setSetting('theme', theme)

export async function listRoutes(): Promise<SavedRoute[]> {
  return ((await db()).getAll('routes') as Promise<SavedRoute[]>).then((routes) => routes.sort((a, b) => b.savedAt.localeCompare(a.savedAt)))
}

export async function saveRoute(route: SavedRoute): Promise<void> {
  await (await db()).put('routes', route)
}

export async function deleteRoute(id: string): Promise<void> {
  await (await db()).delete('routes', id)
}

function safeSegments(path: string): string[] {
  const parts = path.split('/').filter(Boolean)
  if (!parts.length || parts.some((part) => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === '..')) throw new Error('Invalid file path')
  return parts
}

async function fileHandle(path: string, create: boolean) {
  const parts = safeSegments(path)
  let directory = await navigator.storage.getDirectory()
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create })
  return directory.getFileHandle(parts.at(-1)!, { create })
}

export async function storedFile(path: string): Promise<File | null> {
  try { return await (await fileHandle(path, false)).getFile() } catch { return null }
}

export async function assetReady(asset: Asset): Promise<boolean> {
  const file = await storedFile(asset.path)
  return !!file && file.size === asset.bytes
}

export async function downloadAsset(asset: Asset, onProgress?: (loaded: number) => void, signal?: AbortSignal): Promise<void> {
  if (await assetReady(asset)) return
  const estimate = await navigator.storage.estimate()
  if (estimate.quota && estimate.quota - (estimate.usage ?? 0) < asset.bytes * 1.1) {
    throw new Error('Not enough browser storage for this download. Remove an offline area and try again.')
  }
  const response = await fetch(asset.url, { cache: 'no-store', signal })
  if (!response.ok || !response.body) throw new Error('Could not download offline data. Check your connection.')
  const expectedHeader = Number(response.headers.get('content-length'))
  if (Number.isFinite(expectedHeader) && expectedHeader > 0 && expectedHeader !== asset.bytes) throw new Error('Offline data changed. Refresh the page and try again.')
  const handle = await fileHandle(asset.path, true)
  const writer = await handle.createWritable()
  const reader = response.body.getReader()
  let loaded = 0
  try {
    while (true) {
      signal?.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      await writer.write(value as Uint8Array<ArrayBuffer>)
      loaded += value.byteLength
      onProgress?.(loaded)
    }
    if (loaded !== asset.bytes) throw new Error('Download was interrupted. Please try again.')
    signal?.throwIfAborted()
    await writer.close()
  } catch (error) {
    await writer.abort()
    throw error
  }
}

export async function removeAsset(path: string): Promise<void> {
  const parts = safeSegments(path)
  let directory = await navigator.storage.getDirectory()
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part)
  await directory.removeEntry(parts.at(-1)!)
}

export async function clearAllAppData(): Promise<void> {
  navigator.serviceWorker?.controller?.postMessage('DISABLE_AND_CLEAR')
  if (database) { (await database).close(); database = null }
  await deleteDB(dbName)
  const root = await navigator.storage.getDirectory()
  const keys = root as FileSystemDirectoryHandle & { keys(): AsyncIterable<string> }
  for await (const name of keys.keys()) await root.removeEntry(name, { recursive: true })
  for (const key of await caches.keys()) await caches.delete(key)
  for (const worker of await navigator.serviceWorker?.getRegistrations() ?? []) await worker.unregister()
}
