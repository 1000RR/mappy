import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { basename, join, resolve } from 'node:path'

const project = resolve(import.meta.dirname, '..')
const data = resolve(project, 'data')
const maps = join(data, 'maps')
const graph = join(data, 'graph')
const source = process.env.PMTILES_SOURCE
const binary = process.env.PMTILES_BIN ?? 'pmtiles'
const bounds = [-123.15, 36.88, -121.38, 38.88]
const miles = 15
const latStep = miles / 69.0
const lonStep = miles / (69.0 * Math.cos(37.85 * Math.PI / 180))
const only = process.env.ONLY_CELL

if (!source) throw new Error('Set PMTILES_SOURCE to a local or remote Protomaps basemap archive')
await mkdir(maps, { recursive: true })

function run(command, args) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { stdio: 'inherit' })
    process.on('error', reject)
    process.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)))
  })
}

const areas = []
for (let row = 0, south = bounds[1]; south < bounds[3]; row++, south += latStep) {
  for (let col = 0, west = bounds[0]; west < bounds[2]; col++, west += lonStep) {
    const id = `bay-r${row}-c${col}`
    if (only && only !== id) continue
    const bbox = [west, south, Math.min(west + lonStep, bounds[2]), Math.min(south + latStep, bounds[3])]
    const filename = `${id}.pmtiles`
    const output = join(maps, filename)
    try { await stat(output) } catch {
      await run(binary, ['extract', source, output, `--bbox=${bbox.join(',')}`])
    }
    areas.push({ id, bbox, path: `maps/${filename}`, url: `/data/maps/${filename}`, bytes: (await stat(output)).size })
  }
}

let graphEntry = null
try {
  const releases = (await readdir(graph, { withFileTypes: true })).filter((item) => item.isDirectory())
  if (releases.length > 1) throw new Error('Keep one graph release in data/graph when generating the manifest')
  if (releases.length === 1) {
    const release = releases[0].name
    const root = join(graph, release)
    const filenames = ['manifest.json', 'config.json', 'graph.tar']
    const files = []
    for (const filename of filenames) {
      files.push({ path: `graph/${release}/${filename}`, url: `/data/graph/${release}/${filename}`, bytes: (await stat(join(root, filename))).size })
    }
    const graphManifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))
    graphEntry = { manifestUrl: `/data/graph/${release}/manifest.json`, coverage: graphManifest.coverage, files }
  }
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

const manifest = { version: new Date().toISOString().slice(0, 10), bounds, areas, graph: graphEntry }
await writeFile(join(data, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`Wrote ${areas.length} map areas to data/manifest.json`)
