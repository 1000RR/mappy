import { createReadStream } from 'node:fs'
import { mkdir, rename, unlink } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const input = process.argv[2]
if (!input) throw new Error('Usage: node scripts/build-search-index.mjs /path/to/bay.geojsonseq')
const bounds = [-123.15, 36.88, -121.38, 38.88]
await mkdir(resolve('data'), { recursive: true })
const output = resolve('data/search.sqlite')
const temporary = resolve('data/search.sqlite.tmp')
await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error })
const database = new DatabaseSync(temporary)
database.exec(`PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
  CREATE TABLE places (id INTEGER PRIMARY KEY, name TEXT NOT NULL, detail TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL);
  CREATE VIRTUAL TABLE search_fts USING fts5(name, detail, content='places', content_rowid='id', tokenize='unicode61 remove_diacritics 2');`)
const insert = database.prepare('INSERT INTO places (name, detail, lat, lon) VALUES (?, ?, ?, ?)')

function pointOf(geometry) {
  if (geometry?.type === 'Point') return geometry.coordinates
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity
  function scan(value) {
    if (typeof value?.[0] === 'number' && typeof value?.[1] === 'number') {
      west = Math.min(west, value[0]); east = Math.max(east, value[0])
      south = Math.min(south, value[1]); north = Math.max(north, value[1])
    } else if (Array.isArray(value)) for (const item of value) scan(item)
  }
  scan(geometry?.coordinates)
  return [west + (east - west) / 2, south + (north - south) / 2]
}

let count = 0
database.exec('BEGIN')
for await (const line of createInterface({ input: createReadStream(input) })) {
  if (!line.trim()) continue
  const feature = JSON.parse(line.replace(/^\x1e/, ''))
  const tags = feature.properties ?? {}
  const address = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ')
  const name = String(address || tags.name || '').trim()
  if (name.length < 3 || name.length > 120) continue
  const [lon, lat] = pointOf(feature.geometry)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lon < bounds[0] || lon > bounds[2] || lat < bounds[1] || lat > bounds[3]) continue
  const detail = [tags['addr:city'] || tags['is_in:city'], tags['addr:state'] || 'CA'].filter(Boolean).join(', ')
  insert.run(name, detail, lat, lon)
  count++
  if (count % 10000 === 0) database.exec('COMMIT; BEGIN')
}
database.exec('COMMIT')
database.exec("INSERT INTO search_fts(search_fts) VALUES('rebuild')")
database.close()
await rename(temporary, output)
console.log(`Indexed ${count} Bay Area places and addresses in data/search.sqlite`)
