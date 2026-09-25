import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

const source = process.argv[2]
if (!source) throw new Error('Usage: node scripts/import-graph.mjs /path/to/valhalla-wasm/public/datasets/RELEASE')
const project = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'))
const release = basename(resolve(source))
if (manifest.release !== release) throw new Error('Graph release directory must match manifest.release')
const destination = join(project, 'data', 'graph', release)
await mkdir(destination, { recursive: true })
for (const filename of ['manifest.json', 'config.json', 'graph.tar']) await cp(join(source, filename), join(destination, filename))
console.log(`Imported graph ${release} (${(await stat(join(destination, 'graph.tar'))).size} bytes)`)
console.log('Run npm run data:maps to refresh data/manifest.json.')
