const CACHE = 'mappy-shell-v3'
const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg', '/api/manifest']
let disabled = false

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    for (let index = 0; index < PRECACHE.length; index += 32) await cache.addAll(PRECACHE.slice(index, index + 32))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('mappy-shell-') && key !== CACHE).map((key) => caches.delete(key))))
  ]))
})

self.addEventListener('message', (event) => {
  if (event.data === 'DISABLE_AND_CLEAR') disabled = true
})

async function localFile(path) {
  try {
    const parts = path.split('/').filter(Boolean)
    if (!parts.length || parts.some((part) => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === '..')) return null
    let directory = await navigator.storage.getDirectory()
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part)
    return await (await directory.getFileHandle(parts.at(-1))).getFile()
  } catch { return null }
}

async function graphResponse(request, url) {
  const path = url.pathname.slice('/data/'.length)
  const file = await localFile(path)
  if (!file) return fetch(request)
  const catalogResponse = await (await caches.open(CACHE)).match('/api/manifest')
  const catalog = catalogResponse ? await catalogResponse.json() : null
  const expected = catalog?.graph?.files?.find((entry) => entry.path === path)?.bytes
  if (expected !== file.size) return fetch(request)
  const range = request.headers.get('range')
  const type = path.endsWith('.json') ? 'application/json' : 'application/octet-stream'
  let etag = null
  if (path.endsWith('/graph.tar')) {
    const manifest = await localFile(path.replace(/graph\.tar$/, 'manifest.json'))
    if (manifest) etag = (JSON.parse(await manifest.text())).archive.etag
  }
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes' }
  if (etag) headers.ETag = etag
  if (!range) return new Response(file, { status: 200, headers: { ...headers, 'Content-Length': String(file.size) } })
  const match = range.match(/^bytes=(\d+)-(\d*)$/)
  if (!match) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${file.size}` } })
  const start = Number(match[1])
  const end = match[2] ? Math.min(Number(match[2]), file.size - 1) : file.size - 1
  if (start >= file.size || end < start) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${file.size}` } })
  return new Response(file.slice(start, end + 1), { status: 206, headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${file.size}` } })
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
  return response
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(request, response.clone())
    return response
  } catch {
    return await cache.match(request) || Response.error()
  }
}

self.addEventListener('fetch', (event) => {
  if (disabled || event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/data/graph/')) { event.respondWith(graphResponse(event.request, url)); return }
  if (url.pathname === '/api/manifest') { event.respondWith(networkFirst(event.request)); return }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/data/maps/')) return
  event.respondWith(cacheFirst(event.request))
})
