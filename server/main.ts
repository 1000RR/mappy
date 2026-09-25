import 'reflect-metadata'
import { Controller, Get, Module, Query, Injectable, HttpException, HttpStatus } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import express from 'express'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve, join, extname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const dataDir = resolve(process.env.DATA_DIR ?? join(process.cwd(), 'data'))
const webDir = resolve(process.cwd(), 'dist')
const bayBounds = [-123.15, 36.88, -121.38, 38.88]

@Injectable()
class DataService {
  manifest() {
    const filename = join(dataDir, 'manifest.json')
    if (!existsSync(filename)) return { version: 'unavailable', bounds: bayBounds, areas: [], graph: null }
    return JSON.parse(readFileSync(filename, 'utf8')) as unknown
  }
}

type SearchEntry = { name: string; detail: string; lat: number; lon: number }

@Injectable()
class SearchService {
  private database: DatabaseSync | null = null
  private modified = 0

  private normalize(value: string) {
    return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  }

  search(query: string) {
    const filename = join(dataDir, 'search.sqlite')
    if (!existsSync(filename)) throw new HttpException('Address search data is not installed', HttpStatus.SERVICE_UNAVAILABLE)
    const modified = statSync(filename).mtimeMs
    if (!this.database || modified !== this.modified) {
      this.database?.close()
      this.database = new DatabaseSync(filename, { readOnly: true })
      this.modified = modified
    }
    const terms = this.normalize(query).split(' ').filter(Boolean).map((term) => `"${term}"*`)
    if (!terms.length) return []
    const rows = this.database.prepare(`SELECT places.name, places.detail, places.lat, places.lon
      FROM search_fts JOIN places ON places.id = search_fts.rowid
      WHERE search_fts MATCH ? ORDER BY bm25(search_fts) LIMIT 80`).all(terms.join(' AND ')) as SearchEntry[]
    const results: SearchEntry[] = []
    for (const entry of rows) {
      const name = this.normalize(entry.name)
      if (results.some((found) => this.normalize(found.name) === name && Math.abs(found.lat - entry.lat) < 0.001 && Math.abs(found.lon - entry.lon) < 0.001)) continue
      results.push(entry)
      if (results.length === 6) break
    }
    return results
  }
}

@Controller('api')
class ApiController {
  constructor(private readonly data: DataService, private readonly addresses: SearchService) {}

  @Get('manifest')
  manifest() {
    return this.data.manifest()
  }

  @Get('health')
  health() {
    return { ok: true, dataReady: existsSync(join(dataDir, 'manifest.json')) }
  }

  @Get('search')
  async search(@Query('q') q?: string) {
    const query = q?.trim() ?? ''
    if (query.length < 3 || query.length > 160) return { results: [] }
    if (!process.env.PHOTON_URL) return { results: this.addresses.search(query) }
    const target = new URL('/api', process.env.PHOTON_URL)
    target.searchParams.set('q', query)
    target.searchParams.set('limit', '6')
    target.searchParams.set('bbox', bayBounds.join(','))
    try {
      const response = await fetch(target, { signal: AbortSignal.timeout(5000) })
      if (!response.ok) throw new Error(`Photon status ${response.status}`)
      const body = await response.json() as { features?: Array<{ geometry: { coordinates: [number, number] }, properties: Record<string, string> }> }
      return {
        results: (body.features ?? []).map((feature) => ({
          name: feature.properties.name ?? [feature.properties.housenumber, feature.properties.street].filter(Boolean).join(' '),
          detail: [feature.properties.city, feature.properties.state].filter(Boolean).join(', '),
          lon: feature.geometry.coordinates[0],
          lat: feature.geometry.coordinates[1]
        }))
      }
    } catch {
      return { results: this.addresses.search(query) }
    }
  }
}

@Module({ controllers: [ApiController], providers: [DataService, SearchService] })
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] })
  app.enableShutdownHooks()
  const server = app.getHttpAdapter().getInstance() as express.Express
  server.use('/data', express.static(dataDir, {
    index: false,
    acceptRanges: true,
    immutable: true,
    maxAge: '1y',
    setHeaders(response, filename) {
      if (!filename.endsWith('/graph.tar')) return
      const graphManifest = join(resolve(filename, '..'), 'manifest.json')
      if (!existsSync(graphManifest)) return
      const etag = (JSON.parse(readFileSync(graphManifest, 'utf8')) as { archive: { etag: string } }).archive.etag
      response.setHeader('ETag', etag)
    }
  }))
  if (existsSync(webDir)) {
    server.use(express.static(webDir, { maxAge: '1h', index: false }))
    server.get(/.*/, (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/data/') || extname(req.path)) return next()
      res.sendFile(join(webDir, 'index.html'))
    })
  }
  await app.listen(Number(process.env.PORT ?? 3001), '0.0.0.0')
}

void bootstrap()
