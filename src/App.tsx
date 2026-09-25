import { useCallback, useEffect, useRef, useState } from 'react'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { Bike, CarFront, Check, ChevronDown, ChevronUp, Crosshair, Download, Footprints, Layers3, LocateFixed, Map as MapIcon, MoreHorizontal, Navigation, Plus, RotateCcw, Search, Settings2, Trash2, Undo2, Upload, X } from 'lucide-react'
import { MapCanvas } from './components/MapCanvas'
import { areaFor, ensureArea, graphReady, loadCachedAreas, loadManifest, resetData } from './lib/data'
import { formatDistance, inBounds, intersects } from './lib/geo'
import { calculateLegs, getRouter, releaseRouter, snapPoint, snapWaypoints } from './lib/routing'
import { clearAllAppData, deleteRoute, getDraft, getLastLocation, getTheme, listRoutes, saveRoute, setDraft, setLastLocation, setTheme } from './lib/storage'
import type { Coordinate, DataManifest, Leg, Mode, RouteDraft, SavedRoute, Theme, Waypoint } from './lib/types'
import { BAY_BOUNDS, BAY_CENTER, EMPTY_DRAFT } from './lib/types'

type SearchResult = { name: string; detail: string; lat: number; lon: number }
type Viewport = { center: Coordinate; bounds: [number, number, number, number]; zoom: number }
const modeOptions: Array<{ value: Mode; label: string; icon: typeof CarFront }> = [
  { value: 'auto', label: 'Drive', icon: CarFront },
  { value: 'bicycle', label: 'Bike', icon: Bike },
  { value: 'pedestrian', label: 'Walk', icon: Footprints }
]
const themeNames: Record<Theme, string> = { calm: 'Calm light', classic: 'Classic', dark: 'Dark' }
const formatStorage = (bytes: number) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`

function getPosition(): Promise<Coordinate> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location unavailable'))
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lon: coords.longitude }),
      reject,
      { timeout: 7000, maximumAge: 60000, enableHighAccuracy: false }
    )
  })
}

function safeRoute(value: unknown): SavedRoute | null {
  if (!value || typeof value !== 'object') return null
  const route = value as Partial<SavedRoute> & { format?: string }
  if (route.format !== 'mappy-route-v1' || !Array.isArray(route.waypoints) || route.waypoints.length > 100 || !['auto', 'bicycle', 'pedestrian'].includes(route.mode ?? '')) return null
  if (!route.waypoints.every((point) => point && Number.isFinite(point.original?.lat) && Number.isFinite(point.original?.lon) && inBounds(point.original, BAY_BOUNDS))) return null
  return { id: crypto.randomUUID(), name: String(route.name ?? 'Imported route').slice(0, 80), mode: route.mode!, waypoints: route.waypoints.map((point) => ({ id: crypto.randomUUID(), original: point.original, snapped: null })), savedAt: new Date().toISOString() }
}

export default function App() {
  const [catalog, setCatalog] = useState<DataManifest | null>(null)
  const [draft, setRouteDraft] = useState<RouteDraft>(EMPTY_DRAFT)
  const [legs, setLegs] = useState<Leg[]>([])
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([])
  const [theme, setMapTheme] = useState<Theme>('calm')
  const [center, setCenter] = useState<Coordinate>(BAY_CENTER)
  const [focusZoom, setFocusZoom] = useState(12.3)
  const [currentLocation, setCurrentLocation] = useState<Coordinate | null>(null)
  const [viewport, setViewport] = useState<Viewport | null>(null)
  const [mapRevision, setMapRevision] = useState(0)
  const [readyAreas, setReadyAreas] = useState<string[]>([])
  const [routingReady, setRoutingReady] = useState(false)
  const [areaProgress, setAreaProgress] = useState<{ label: string; percent: number } | null>(null)
  const [routeProgress, setRouteProgress] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(true)
  const [themeOpen, setThemeOpen] = useState(false)
  const [showCoverage, setShowCoverage] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [clearConfirm, setClearConfirm] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [routeName, setRouteName] = useState('')
  const [history, setHistory] = useState<Array<{ draft: RouteDraft; legs: Leg[] }>>([])
  const [hydrated, setHydrated] = useState(false)
  const map = useRef<MaplibreMap | null>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const autoDownload = useRef(true)
  const downloading = useRef(new Set<string>())
  const areaDownloads = useRef(new Map<string, { controller: AbortController; task: Promise<void> }>())
  const draftRef = useRef(draft)
  const restoredRoute = useRef(false)
  draftRef.current = draft
  const totalKm = legs.reduce((sum, leg) => sum + leg.distanceKm, 0)
  const coverageBounds = catalog?.bounds ?? BAY_BOUNDS

  useEffect(() => {
    let active = true
    void (async () => {
      const locationPromise = getPosition().then((point) => ({ point }), () => ({ point: null }))
      const [savedDraft, savedTheme, lastLocation, routes] = await Promise.all([getDraft(), getTheme(), getLastLocation(), listRoutes()])
      if (!active) return
      if (savedDraft) setRouteDraft(savedDraft)
      if (savedTheme) setMapTheme(savedTheme)
      setHydrated(true)
      setSavedRoutes(routes)
      if (lastLocation) setCenter(lastLocation.point)
      try {
        const data = await loadManifest()
        if (!active) return
        setCatalog(data)
        setReadyAreas(await loadCachedAreas(data))
        setRoutingReady(await graphReady(data))
      } catch {
        setNotice('Map catalog is unavailable. Start the NestJS server to load map data.')
      }
      const { point } = await locationPromise
      if (point) {
        if (!active) return
        setCurrentLocation(point)
        setCenter(point)
        setFocusZoom(12.5)
        await setLastLocation(point)
        if (!inBounds(point, coverageBounds)) setNotice('Your location is outside the current Bay Area coverage. Search within the Bay Area to plan a route.')
      } else {
        if (!lastLocation && active) setNotice('Location is unavailable. Search for a Bay Area address or move the map to begin.')
      }
    })()
    return () => { active = false }
  }, [])

  useEffect(() => { if (hydrated && autoDownload.current) void setDraft(draft) }, [draft, hydrated])
  useEffect(() => { if (hydrated && autoDownload.current) void setTheme(theme); document.documentElement.dataset.theme = theme }, [theme, hydrated])

  useEffect(() => {
    if (!catalog || !viewport || !autoDownload.current || catalog.areas.length === 0) return
    const visible = catalog.areas.filter((area) => intersects(area.bbox, viewport.bounds))
    const selected = viewport.zoom < 10 ? [areaFor(viewport.center, catalog)].filter(Boolean) : visible.slice(0, 4)
    for (const area of selected) {
      if (!area || readyAreas.includes(area.id) || downloading.current.has(area.id)) continue
      downloading.current.add(area.id)
      const controller = new AbortController()
      const label = `Saving this map area (${formatStorage(area.bytes)})`
      setAreaProgress({ label, percent: 0 })
      const task = ensureArea(area, (loaded) => {
        if (!controller.signal.aborted) setAreaProgress({ label, percent: Math.min(100, Math.round(loaded / area.bytes * 100)) })
      }, controller.signal)
        .then(() => { if (!controller.signal.aborted) { setReadyAreas((ids) => [...new Set([...ids, area.id])]); setMapRevision((value) => value + 1) } })
        .catch((error: Error) => { if (!controller.signal.aborted) setNotice(error.message) })
        .finally(() => { downloading.current.delete(area.id); areaDownloads.current.delete(area.id); if (!areaDownloads.current.size) setAreaProgress(null) })
      areaDownloads.current.set(area.id, { controller, task })
      break
    }
  }, [catalog, viewport, readyAreas])

  useEffect(() => {
    if (searchQuery.trim().length < 3) { setSearchResults([]); setSearching(false); return }
    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setSearching(true)
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(searchQuery.trim())}`, { signal: controller.signal })
        if (!response.ok) throw new Error('Search unavailable')
        const data = await response.json() as { results: SearchResult[] }
        setSearchResults(data.results)
      } catch { if (!controller.signal.aborted) setSearchResults([]) }
      finally { if (!controller.signal.aborted) setSearching(false) }
    }, 300)
    return () => { controller.abort(); clearTimeout(timeout) }
  }, [searchQuery])

  const commit = useCallback((next: RouteDraft, nextLegs: Leg[]) => {
    setHistory((items) => [...items.slice(-19), { draft: draftRef.current, legs }])
    setRouteDraft(next)
    setLegs(nextLegs)
    setNotice(null)
  }, [legs])

  const withEngine = useCallback(async <T,>(operation: (engine: Awaited<ReturnType<typeof getRouter>>) => Promise<T>): Promise<T> => {
    if (!catalog) throw new Error('Map data is still loading.')
    const engine = await getRouter(catalog, (loaded, total) => setRouteProgress(Math.round(loaded / total * 100)))
    setRoutingReady(true)
    setRouteProgress(null)
    return operation(engine)
  }, [catalog])

  useEffect(() => {
    if (!hydrated || !catalog || restoredRoute.current || draft.waypoints.length < 2 || legs.length || busy) return
    restoredRoute.current = true
    const snapshot = draft.waypoints.map((point) => point.id).join(',') + draft.mode
    void withEngine((engine) => calculateLegs(draft.waypoints, draft.mode, engine))
      .then((result) => {
        if (draftRef.current.waypoints.map((point) => point.id).join(',') + draftRef.current.mode === snapshot) setLegs(result)
      })
      .catch((error: Error) => setNotice(error.message))
  }, [hydrated, catalog, draft, legs.length, busy, withEngine])

  const addWaypoint = useCallback(async (point: Coordinate, insertionIndex?: number) => {
    if (busy) return
    if (!inBounds(point, coverageBounds)) { setNotice('Waypoints are available within the Bay Area for now.'); return }
    if (catalog?.graph && !inBounds(point, catalog.graph.coverage)) { setNotice('Routing data for this part of the Bay Area is not available yet.'); return }
    setBusy(true)
    try {
      const previous = draftRef.current
      const waypoint = await withEngine(async (engine) => ({ id: crypto.randomUUID(), original: point, snapped: await snapPoint(point, previous.mode, engine) }))
      const at = insertionIndex === undefined ? previous.waypoints.length : Math.min(Math.max(insertionIndex, 0), previous.waypoints.length)
      const waypoints = [...previous.waypoints]
      waypoints.splice(at, 0, waypoint)
      const next = { ...previous, waypoints }
      const nextLegs = await withEngine((engine) => calculateLegs(waypoints, previous.mode, engine))
      commit(next, nextLegs)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not add this waypoint.') }
    finally { setBusy(false); setRouteProgress(null) }
  }, [busy, coverageBounds, catalog, withEngine, commit])

  const moveWaypoint = useCallback(async (id: string, point: Coordinate) => {
    if (busy) return
    if (catalog?.graph && !inBounds(point, catalog.graph.coverage)) { setNotice('Routing data for this part of the Bay Area is not available yet.'); setMapRevision((value) => value + 1); return }
    setBusy(true)
    try {
      const previous = draftRef.current
      const snapped = await withEngine((engine) => snapPoint(point, previous.mode, engine))
      const waypoints = previous.waypoints.map((waypoint) => waypoint.id === id ? { ...waypoint, original: point, snapped } : waypoint)
      const nextLegs = await withEngine((engine) => calculateLegs(waypoints, previous.mode, engine))
      commit({ ...previous, waypoints }, nextLegs)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not move this waypoint.'); setMapRevision((value) => value + 1) }
    finally { setBusy(false) }
  }, [busy, catalog, withEngine, commit])

  const changeMode = async (mode: Mode) => {
    if (busy || mode === draft.mode) return
    if (!draft.waypoints.length) { commit({ ...draft, mode }, []); return }
    setBusy(true)
    try {
      const waypoints = await withEngine((engine) => snapWaypoints(draft.waypoints, mode, engine))
      const nextLegs = await withEngine((engine) => calculateLegs(waypoints, mode, engine))
      commit({ mode, waypoints }, nextLegs)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not route with this mode.') }
    finally { setBusy(false) }
  }

  const changeWaypoints = async (waypoints: Waypoint[]) => {
    if (busy) return
    setBusy(true)
    try {
      const nextLegs = await withEngine((engine) => calculateLegs(waypoints, draft.mode, engine))
      commit({ ...draft, waypoints }, nextLegs)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not update the route.') }
    finally { setBusy(false) }
  }

  const recenter = async () => {
    try {
      const point = await getPosition()
      setCurrentLocation(point)
      setCenter(point)
      setFocusZoom(13)
      await setLastLocation(point)
    } catch { setNotice('Location is unavailable. Check your browser location permission.') }
  }

  const saveCurrent = async () => {
    const name = routeName.trim() || `Route ${new Date().toLocaleDateString()}`
    const route: SavedRoute = { ...draft, id: crypto.randomUUID(), name, savedAt: new Date().toISOString() }
    await saveRoute(route)
    setSavedRoutes(await listRoutes())
    setRouteName('')
    setSaveOpen(false)
    setNotice(`Saved “${name}” on this device.`)
  }

  const exportCurrent = () => {
    const body = JSON.stringify({ format: 'mappy-route-v1', name: routeName.trim() || 'My route', ...draft }, null, 2)
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }))
    link.download = 'mappy-route.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  }

  const openRoute = async (route: SavedRoute) => {
    if (busy) return
    setBusy(true)
    try {
      const waypoints = await withEngine((engine) => snapWaypoints(route.waypoints, route.mode, engine))
      const routedLegs = await withEngine((engine) => calculateLegs(waypoints, route.mode, engine))
      commit({ mode: route.mode, waypoints }, routedLegs)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not open this route.') }
    finally { setBusy(false) }
  }

  const importRoute = async (file: File) => {
    try {
      const route = safeRoute(JSON.parse(await file.text()))
      if (!route) throw new Error('This is not a Mappy route file.')
      await saveRoute(route)
      setSavedRoutes(await listRoutes())
      await openRoute(route)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not import route.') }
  }

  const clearEverything = async () => {
    setBusy(true)
    try {
      autoDownload.current = false
      for (const { controller } of areaDownloads.current.values()) controller.abort()
      await Promise.allSettled([...areaDownloads.current.values()].map(({ task }) => task))
      await releaseRouter()
      await clearAllAppData()
      resetData()
      setRouteDraft(EMPTY_DRAFT)
      setLegs([])
      setHistory([])
      setSavedRoutes([])
      setReadyAreas([])
      setCurrentLocation(null)
      setMapTheme('calm')
      setCenter(BAY_CENTER)
      setFocusZoom(12.3)
      setRoutingReady(false)
      setMapRevision((value) => value + 1)
      setSettingsOpen(false)
      setClearConfirm(false)
      setNotice('All app data has been cleared. Reload to start again.')
    } catch { setNotice('Could not clear every file. Try your browser’s site-data settings.') }
    finally { setBusy(false) }
  }

  return <div className={`app theme-${theme}`}>
    <MapCanvas theme={theme} center={center} focusZoom={focusZoom} currentLocation={currentLocation} waypoints={draft.waypoints} legs={legs} revision={mapRevision}
      areas={catalog?.areas} readyAreas={readyAreas} graphCoverage={catalog?.graph?.coverage} routingReady={routingReady} showCoverage={showCoverage}
      onMapClick={(point, at) => { void addWaypoint(point, at) }} onDragPoint={(id, point) => { void moveWaypoint(id, point) }}
      onViewport={(point, bounds, zoom) => setViewport({ center: point, bounds, zoom })} onReady={(instance) => { map.current = instance }} />

    <div className="topbar">
      <div className="brand" aria-label="Mappy"><span className="brand-icon"><Navigation size={19} fill="currentColor" /></span><span>Mappy</span></div>
      <div className="search-wrap">
        <Search size={19} className="search-icon" />
        <input aria-label="Search Bay Area addresses" placeholder="Search Bay Area addresses" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
        {searchQuery && <button className="icon-plain" aria-label="Clear search" onClick={() => { setSearchQuery(''); setSearchResults([]) }}><X size={17} /></button>}
        {(searchResults.length > 0 || searching) && <div className="search-results">
          {searching && <p className="search-status">Searching…</p>}
          {searchResults.map((result, index) => <button key={`${result.lat}-${index}`} onClick={() => {
            const point = { lat: result.lat, lon: result.lon }
            setCenter(point)
            setFocusZoom(14)
            setSearchQuery('')
            setSearchResults([])
          }}><span className="result-icon"><Search size={16} /></span><span><strong>{result.name}</strong><small>{result.detail}</small></span></button>)}
        </div>}
      </div>
      <button className="top-settings" aria-label="Open settings" onClick={() => setSettingsOpen(true)}><Settings2 size={19} /></button>
    </div>

    <aside className={`route-panel ${sheetOpen ? 'open' : 'closed'}`}>
      <button className="sheet-handle" aria-label={sheetOpen ? 'Collapse route panel' : 'Expand route panel'} onClick={() => setSheetOpen(!sheetOpen)}><span /><span className="sheet-title">Your route</span>{sheetOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}</button>
      <div className="panel-content">
        <div className="panel-heading"><div><span className="eyebrow">ROUTE PLANNER</span><h1>Your route</h1></div><button className="icon-plain more-button" aria-label="Open settings" onClick={() => setSettingsOpen(true)}><MoreHorizontal /></button></div>
        <div className="mode-switch" role="group" aria-label="Travel mode">{modeOptions.map(({ value, label, icon: Icon }) => <button key={value} disabled={busy} className={draft.mode === value ? 'active' : ''} onClick={() => { void changeMode(value) }}><Icon size={18} /><span>{label}</span></button>)}</div>
        <div className="route-total"><span>Total distance</span><strong>{legs.length ? formatDistance(totalKm) : '—'}</strong><small>{draft.waypoints.length < 2 ? 'Add at least two points to see a route' : `${draft.waypoints.length} stops · ${legs.length} leg${legs.length === 1 ? '' : 's'}`}</small></div>
        <div className="waypoints-list">
          {draft.waypoints.length === 0 ? <div className="empty-route"><div className="empty-icon"><Plus size={23} /></div><strong>Start with a point on the map</strong><p>Click anywhere to add your first waypoint. Add more to calculate a route.</p><button onClick={() => { if (currentLocation) void addWaypoint(currentLocation); else void recenter() }}><LocateFixed size={16} /> Use my location</button></div> : draft.waypoints.map((waypoint, index) => <div className="waypoint-row" key={waypoint.id}>
            <span className={`waypoint-number ${index === 0 ? 'start' : ''}`}>{index + 1}</span>
            <div className="waypoint-copy"><strong>{index === 0 ? 'Start' : index === draft.waypoints.length - 1 ? 'Destination' : `Stop ${index + 1}`}</strong><small>{waypoint.snapped ? `${waypoint.snapped.lat.toFixed(5)}, ${waypoint.snapped.lon.toFixed(5)}` : 'Finding nearby road…'}</small>{legs[index] && <em>{formatDistance(legs[index].distanceKm)} to next stop</em>}</div>
            <div className="waypoint-actions"><button title="Move up" aria-label={`Move waypoint ${index + 1} up`} disabled={index === 0 || busy} onClick={() => { const points = [...draft.waypoints]; [points[index - 1], points[index]] = [points[index], points[index - 1]]; void changeWaypoints(points) }}><ChevronUp size={15} /></button><button title="Remove" aria-label={`Remove waypoint ${index + 1}`} disabled={busy} onClick={() => { void changeWaypoints(draft.waypoints.filter((item) => item.id !== waypoint.id)) }}><X size={16} /></button></div>
          </div>)}
        </div>
        {draft.waypoints.length > 0 && <div className="route-actions"><button disabled={busy || !history.length} onClick={() => { const previous = history.at(-1); if (!previous) return; setHistory(history.slice(0, -1)); setRouteDraft(previous.draft); setLegs(previous.legs) }}><Undo2 size={16} /> Undo</button><button disabled={busy} onClick={() => commit({ ...draft, waypoints: [] }, [])}><RotateCcw size={16} /> Clear route</button></div>}
        <div className="panel-divider" />
        <div className="saved-heading"><h2>Saved routes</h2><span>{savedRoutes.length}</span></div>
        {savedRoutes.length ? <div className="saved-list">{savedRoutes.slice(0, 5).map((route) => <div className="saved-row" key={route.id}><button onClick={() => { void openRoute(route) }}><span className="saved-avatar"><Navigation size={16} /></span><span><strong>{route.name}</strong><small>{route.waypoints.length} stops · {new Date(route.savedAt).toLocaleDateString()}</small></span></button><button className="saved-delete" aria-label={`Delete ${route.name}`} onClick={() => { void deleteRoute(route.id).then(async () => setSavedRoutes(await listRoutes())) }}><X size={16} /></button></div>)}</div> : <p className="saved-empty">Routes you save will appear here.</p>}
        {draft.waypoints.length >= 2 && <div className="save-actions"><button className="primary-button" onClick={() => setSaveOpen(true)}><Plus size={17} /> Save route</button><button className="secondary-button" onClick={exportCurrent}><Download size={17} /> Export</button></div>}
      </div>
    </aside>

    <div className="map-controls">
      <div className="control-popover-wrap"><button className="map-control" title="Map style" aria-label="Choose map style" onClick={() => setThemeOpen(!themeOpen)}><Layers3 size={20} /></button>{themeOpen && <div className="theme-menu">{(['calm', 'classic', 'dark'] as Theme[]).map((option) => <button key={option} onClick={() => { setMapTheme(option); setThemeOpen(false) }}><span className={`theme-swatch ${option}`} />{themeNames[option]}{theme === option && <Check size={16} />}</button>)}</div>}</div>
      <div className="control-popover-wrap"><button className={`map-control ${showCoverage ? 'coverage-active' : ''}`} title="Offline coverage" aria-label={showCoverage ? 'Hide offline coverage' : 'Show offline coverage'} aria-pressed={showCoverage} onClick={() => setShowCoverage(!showCoverage)}><MapIcon size={20} /></button>{showCoverage && <div className="coverage-legend" aria-label="Offline coverage legend"><strong>OFFLINE COVERAGE</strong><span><i className="coverage-key both" /> Map + routing</span><span><i className="coverage-key map" /> Map only</span><span><i className="coverage-key graph" /> Routing only</span><span><i className="coverage-key missing" /> Not downloaded</span></div>}</div>
      <button className="map-control" title="My location" aria-label="Go to my location" onClick={() => { void recenter() }}><Crosshair size={20} /></button>
      <div className="zoom-controls"><button className="map-control" aria-label="Zoom in" onClick={() => map.current?.zoomIn()}><Plus size={20} /></button><button className="map-control" aria-label="Zoom out" onClick={() => map.current?.zoomOut()}><span className="minus">−</span></button></div>
    </div>

    <div className="status-bar"><span className={`status-indicator ${readyAreas.length ? 'ready' : ''}`} />{readyAreas.length ? `${readyAreas.length} map area${readyAreas.length === 1 ? '' : 's'} offline` : 'Map data needed'}<span className="status-separator">·</span>{routingReady ? 'Routing offline' : 'Routing data needed'}</div>
    {(areaProgress || routeProgress !== null || busy) && <div className="progress-toast"><span className="spinner" />{areaProgress ? `${areaProgress.label} · ${areaProgress.percent}%` : routeProgress !== null ? `Saving routing data (${formatStorage(catalog?.graph?.files.reduce((sum, file) => sum + file.bytes, 0) ?? 0)}) · ${routeProgress}%` : 'Calculating route…'}</div>}
    {notice && <div className="notice" role="status"><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice(null)}><X size={16} /></button></div>}

    {settingsOpen && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false) }}><div className="dialog" role="dialog" aria-modal="true" aria-label="Settings"><div className="dialog-heading"><h2>Privacy & storage</h2><button className="icon-plain" aria-label="Close settings" onClick={() => setSettingsOpen(false)}><X size={20} /></button></div><p>Routes and downloaded maps stay on this device. Address searches go to this app’s server.</p><div className="storage-row"><span><strong>Offline map areas</strong><small>{readyAreas.length} downloaded</small></span><span><strong>Routing data</strong><small>{routingReady ? 'Ready offline' : 'Not downloaded'}</small></span></div><button className="dialog-action" onClick={() => importInput.current?.click()}><Upload size={18} /> Import route</button><input ref={importInput} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importRoute(file); event.target.value = '' }} /><button className="dialog-action danger" onClick={() => setClearConfirm(true)}><Trash2 size={18} /> Clear all app data</button><p className="footnote">Location permission is managed in your browser or device settings.</p></div></div>}
    {clearConfirm && <div className="dialog-backdrop"><div className="dialog confirm-dialog" role="alertdialog" aria-modal="true" aria-label="Clear all app data"><div className="danger-icon"><Trash2 size={22} /></div><h2>Clear all app data?</h2><p>This removes routes, your last location, map style, downloaded maps, routing data, and offline app files from this browser. This cannot be undone.</p><div className="confirm-actions"><button onClick={() => setClearConfirm(false)}>Cancel</button><button className="danger-button" disabled={busy} onClick={() => { void clearEverything() }}>Clear all data</button></div></div></div>}
    {saveOpen && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSaveOpen(false) }}><form className="dialog" onSubmit={(event) => { event.preventDefault(); void saveCurrent() }}><div className="dialog-heading"><h2>Save route</h2><button type="button" className="icon-plain" aria-label="Close" onClick={() => setSaveOpen(false)}><X size={20} /></button></div><label className="field-label" htmlFor="route-name">Route name</label><input id="route-name" autoFocus value={routeName} maxLength={80} placeholder="Weekend ride" onChange={(event) => setRouteName(event.target.value)} /><button className="primary-button full" type="submit">Save on this device</button></form></div>}
  </div>
}
