import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

const dist = resolve('dist')
const entries = []
async function collect(directory) {
  for (const entry of await readdir(join(dist, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await collect(path)
    else if (path !== 'sw.js' && path !== 'index.html') entries.push(`/${path}`)
  }
}
await collect('')
const filename = join(dist, 'sw.js')
const source = await readFile(filename, 'utf8')
const original = "const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg', '/api/manifest']"
if (!source.includes(original)) throw new Error('Service worker precache declaration changed')
const precache = ['/', '/index.html', '/api/manifest', ...entries]
const version = createHash('sha256').update(JSON.stringify(precache)).digest('hex').slice(0, 12)
await writeFile(filename, source
  .replace("const CACHE = 'mappy-shell-v3'", `const CACHE = 'mappy-shell-${version}'`)
  .replace(original, `const PRECACHE = ${JSON.stringify(precache)}`))
console.log(`Precached ${precache.length} app files for offline reopening`)
