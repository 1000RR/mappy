import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// valhalla-browser 0.2.1 hard-codes a 30 m correlation radius. Keep its
// published worker/runtime and widen only the request radius to the UI's 200 m.
const filename = resolve('node_modules/valhalla-browser/dist/index.js')
const source = await readFile(filename, 'utf8')
if (source.includes('radius: 200,')) process.exit(0)
if (!source.includes('radius: 30,')) throw new Error('Valhalla SDK layout changed; review the snap-radius patch')
await writeFile(filename, source.replace('radius: 30,', 'radius: 200,'))
