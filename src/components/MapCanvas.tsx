import { useEffect, useRef, useState } from 'react'
import maplibregl, { type Map as MaplibreMap, type StyleSpecification, type VectorTileSource } from 'maplibre-gl'
import { DARK, LIGHT, layers, type Flavor } from '@protomaps/basemaps'
import { Plus, Trash2 } from 'lucide-react'
import { getMapTile } from '../lib/data'
import type { Coordinate, Leg, MapArea, RoutePreview, Theme, Waypoint } from '../lib/types'

let protocolAdded = false

type ContextMenu = { x: number; y: number } & (
  { kind: 'add'; point: Coordinate; afterId: string | null; beforeNumber: number | null }
  | { kind: 'remove'; waypointId: string; waypointNumber: number }
)

function mapStyle(theme: Theme, revision: number): StyleSpecification {
  const calm: Flavor = {
    ...LIGHT,
    background: '#f7f6f2', earth: '#f7f6f2', park_a: '#dcebd5', park_b: '#c7dfc6',
    wood_a: '#d6e7d2', wood_b: '#b9d9b7', water: '#bbdce8', major: '#fffdf8',
    minor_a: '#ffffff', minor_b: '#ffffff', highway: '#f7e4b5', buildings: '#e8e4dd',
    city_label: '#344352', roads_label_major: '#65717c', roads_label_minor: '#869098'
  }
  const classic: Flavor = {
    ...LIGHT,
    background: '#f4f2ed', earth: '#f4f2ed', water: '#b7d9ed', park_a: '#d3e8ca',
    park_b: '#badfae', highway: '#f7d787', major: '#ffffff', city_label: '#2f4151'
  }
  const dark: Flavor = {
    ...DARK,
    background: '#17232e', earth: '#1d2b35', water: '#143c4b', park_a: '#26483f',
    park_b: '#2b5848', wood_a: '#24473e', wood_b: '#2b5848', minor_a: '#344450',
    minor_b: '#344450', major: '#485968', highway: '#786744', city_label: '#e2eaf0',
    roads_label_major: '#becbd2', roads_label_minor: '#9aabb5'
  }
  const flavor = theme === 'dark' ? dark : theme === 'classic' ? classic : calm
  return {
    version: 8,
    glyphs: `${window.location.origin}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${window.location.origin}/sprites/v4/${theme === 'dark' ? 'dark' : 'light'}`,
    sources: {
      'offline-map': {
        type: 'vector',
        tiles: [`offline-map://{z}/{x}/{y}?v=${revision}`],
        minzoom: 0,
        maxzoom: 15,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a> · <a href="https://protomaps.com" target="_blank">Protomaps</a>'
      }
    },
    layers: layers('offline-map', flavor, { lang: 'en' })
  }
}

type Props = {
  preview: RoutePreview | null
  onBeginRouteDrag: (point: Coordinate, afterId: string) => boolean
  onUpdateRouteDrag: (point: Coordinate) => void
  onFinishRouteDrag: (point: Coordinate | null) => void
  theme: Theme
  center: Coordinate
  focusZoom: number
  currentLocation: Coordinate | null
  waypoints: Waypoint[]
  legs: Leg[]
  revision: number
  areas?: MapArea[]
  readyAreas: string[]
  graphCoverage?: [number, number, number, number]
  routingReady: boolean
  showCoverage: boolean
  onMapClick: (point: Coordinate, insertionIndex?: number) => void
  onBeginPointDrag: (point: Coordinate, id: string) => boolean
  onRemovePoint: (id: string) => void
  onViewport: (center: Coordinate, bounds: [number, number, number, number], zoom: number) => void
  onReady: (map: MaplibreMap | null) => void
}

export function MapCanvas({ preview, onBeginRouteDrag, onUpdateRouteDrag, onFinishRouteDrag, theme, center, focusZoom, currentLocation, waypoints, legs, revision, areas, readyAreas, graphCoverage, routingReady, showCoverage, onMapClick, onBeginPointDrag, onRemovePoint, onViewport, onReady }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MaplibreMap | null>(null)
  const lastView = useRef({ center, zoom: focusZoom })
  const [mapLoaded, setMapLoaded] = useState(0)
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const menuElement = useRef<HTMLDivElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const markers = useRef(new Map<string, { marker: maplibregl.Marker; element: HTMLButtonElement; point: Coordinate }>())
  const locationMarker = useRef<maplibregl.Marker | null>(null)
  const previewMarker = useRef<maplibregl.Marker | null>(null)
  const routeFeatures = useRef(new Map<string, Coordinate[]>())
  const waypointsRef = useRef(waypoints)
  waypointsRef.current = waypoints
  const handlers = useRef({ onBeginRouteDrag, onUpdateRouteDrag, onFinishRouteDrag, onMapClick, onBeginPointDrag, onRemovePoint, onViewport, onReady })
  handlers.current = { onBeginRouteDrag, onUpdateRouteDrag, onFinishRouteDrag, onMapClick, onBeginPointDrag, onRemovePoint, onViewport, onReady }

  const menuPosition = (x: number, y: number) => {
    const bounds = container.current?.getBoundingClientRect()
    return {
      x: Math.min(Math.max(x, 8), Math.max(8, (bounds?.width ?? 0) - 220)),
      y: Math.min(Math.max(y, 8), Math.max(8, (bounds?.height ?? 0) - 96))
    }
  }

  useEffect(() => {
    if (!contextMenu) return
    menuButton.current?.focus()
    const dismiss = (event: PointerEvent) => {
      if (!menuElement.current?.contains(event.target as Node)) setContextMenu(null)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null)
    }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('keydown', escape)
    }
  }, [contextMenu])

  useEffect(() => { setContextMenu(null) }, [waypoints, theme])

  useEffect(() => {
    if (!container.current) return
    if (!protocolAdded) {
      maplibregl.addProtocol('offline-map', async (params, abort) => {
        const match = params.url.match(/^offline-map:\/\/(\d+)\/(\d+)\/(\d+)/)
        if (!match) throw new Error('Invalid map tile')
        return { data: await getMapTile(Number(match[1]), Number(match[2]), Number(match[3]), abort.signal) }
      })
      protocolAdded = true
    }
    const start = lastView.current
    const instance = new maplibregl.Map({
      container: container.current,
      style: mapStyle(theme, revision),
      center: [start.center.lon, start.center.lat],
      zoom: start.zoom,
      minZoom: 1,
      maxZoom: 19,
      attributionControl: false,
      pitchWithRotate: false,
      dragRotate: false
    })
    map.current = instance
    instance.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    instance.on('load', () => {
      routeFeatures.current.clear()
      instance.addSource('offline-coverage', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      instance.addLayer({ id: 'coverage-missing', type: 'fill', source: 'offline-coverage', filter: ['==', ['get', 'status'], 'missing'], paint: { 'fill-color': theme === 'dark' ? '#0b1520' : '#aab3bd', 'fill-opacity': theme === 'dark' ? 0.56 : 0.42 } })
      instance.addLayer({ id: 'coverage-graph-only', type: 'fill', source: 'offline-coverage', filter: ['==', ['get', 'status'], 'graph'], paint: { 'fill-color': theme === 'dark' ? '#142b34' : '#9aafb7', 'fill-opacity': theme === 'dark' ? 0.55 : 0.4 } })
      instance.addLayer({ id: 'coverage-map-only', type: 'line', source: 'offline-coverage', filter: ['==', ['get', 'status'], 'map'], paint: { 'line-color': '#e49b4b', 'line-width': 2.5, 'line-opacity': 0.94 } })
      instance.addLayer({ id: 'coverage-both', type: 'line', source: 'offline-coverage', filter: ['==', ['get', 'status'], 'both'], paint: { 'line-color': theme === 'dark' ? '#78b9ff' : '#315efb', 'line-width': 2.8, 'line-opacity': 0.94 } })
      instance.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      instance.addLayer({ id: 'route-halo', type: 'line', source: 'route', paint: { 'line-color': theme === 'dark' ? '#102537' : '#ffffff', 'line-width': 10, 'line-opacity': 0.94 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
      instance.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': theme === 'dark' ? '#63adff' : '#315efb', 'line-width': 6 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
      instance.addSource('route-preview', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      instance.addLayer({ id: 'preview-halo', type: 'line', source: 'route-preview', paint: { 'line-color': theme === 'dark' ? '#102537' : '#ffffff', 'line-width': 10, 'line-opacity': 0.85 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
      instance.addLayer({ id: 'preview-line', type: 'line', source: 'route-preview', paint: { 'line-color': theme === 'dark' ? '#63adff' : '#315efb', 'line-width': 6, 'line-dasharray': [0, 1, 2, 0] }, layout: { 'line-cap': 'butt', 'line-join': 'round' } })
      instance.addLayer({ id: 'route-hit', type: 'line', source: 'route', paint: { 'line-color': '#000000', 'line-width': 24, 'line-opacity': 0 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
      setMapLoaded((value) => value + 1)
      handlers.current.onReady(instance)
      const bounds = instance.getBounds()
      handlers.current.onViewport({ lat: instance.getCenter().lat, lon: instance.getCenter().lng }, [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()], instance.getZoom())
    })
    const canvas = instance.getCanvas()
    const surface = container.current!
    let gesture: { pointerId: number; x: number; y: number; afterId: string; waypointId?: string; dragging: boolean; panEnabled: boolean } | null = null
    let suppressClick = false
    const coordinate = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const location = instance.unproject([event.clientX - rect.left, event.clientY - rect.top])
      return { lat: location.lat, lon: location.lng }
    }
    const release = () => {
      const previous = gesture
      gesture = null
      if (previous?.panEnabled) instance.dragPan.enable()
      if (previous && canvas.hasPointerCapture(previous.pointerId)) canvas.releasePointerCapture(previous.pointerId)
      canvas.style.cursor = ''
      return previous
    }
    const cancel = () => {
      const previous = release()
      if (previous?.dragging) handlers.current.onFinishRouteDrag(null)
    }
    const down = (event: PointerEvent) => {
      suppressClick = false
      if (event.button !== 0 || !event.isPrimary || !instance.getLayer('route-hit')) return
      const rect = canvas.getBoundingClientRect()
      const hit = instance.queryRenderedFeatures([event.clientX - rect.left, event.clientY - rect.top], { layers: ['route-hit'] })[0]
      const waypointId = (event.target as Element).closest<HTMLElement>('[data-waypoint-id]')?.dataset.waypointId
      if (!waypointId && event.target !== canvas) return
      const afterId = typeof hit?.properties?.afterId === 'string' ? hit.properties.afterId : ''
      if (!waypointId && !afterId) return
      event.preventDefault()
      event.stopPropagation()
      setContextMenu(null)
      gesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, afterId, waypointId, dragging: false, panEnabled: instance.dragPan.isEnabled() }
      instance.dragPan.disable()
      canvas.setPointerCapture(event.pointerId)
    }
    const move = (event: PointerEvent) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      if (!gesture.dragging) {
        if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 5) return
        const accepted = gesture.waypointId ? handlers.current.onBeginPointDrag(coordinate(event), gesture.waypointId) : handlers.current.onBeginRouteDrag(coordinate(event), gesture.afterId)
        if (!accepted) { suppressClick = true; release(); return }
        gesture.dragging = true
        canvas.style.cursor = 'grabbing'
      } else handlers.current.onUpdateRouteDrag(coordinate(event))
    }
    const up = (event: PointerEvent) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      const rect = canvas.getBoundingClientRect()
      const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
      const previous = release()!
      suppressClick = true
      if (previous.dragging) handlers.current.onFinishRouteDrag(inside ? coordinate(event) : null)
      else if (inside && !previous.waypointId) handlers.current.onMapClick(coordinate(event))
    }
    const click = (event: MouseEvent) => {
      if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation() }
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { suppressClick = true; cancel(); handlers.current.onFinishRouteDrag(null) } }
    surface.addEventListener('pointerdown', down, true)
    surface.addEventListener('pointermove', move, true)
    surface.addEventListener('pointerup', up, true)
    surface.addEventListener('pointercancel', cancel)
    surface.addEventListener('lostpointercapture', cancel)
    surface.addEventListener('click', click, true)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', escape)
    instance.on('mouseenter', 'route-hit', () => { if (!gesture) canvas.style.cursor = 'grab' })
    instance.on('mouseleave', 'route-hit', () => { if (!gesture) canvas.style.cursor = '' })
    instance.on('click', (event) => {
      setContextMenu(null)
      handlers.current.onMapClick({ lat: event.lngLat.lat, lon: event.lngLat.lng })
    })
    instance.on('contextmenu', (event) => {
      event.originalEvent.preventDefault()
      const hit = instance.getLayer('route-hit') ? instance.queryRenderedFeatures(event.point, { layers: ['route-hit'] })[0] : undefined
      const afterId = typeof hit?.properties?.afterId === 'string' ? hit.properties.afterId : null
      const beforeNumber = afterId ? waypointsRef.current.findIndex((point) => point.id === afterId) : -1
      setContextMenu({ kind: 'add', point: { lat: event.lngLat.lat, lon: event.lngLat.lng }, afterId, beforeNumber: beforeNumber >= 0 ? beforeNumber : null, ...menuPosition(event.point.x, event.point.y) })
    })
    instance.on('movestart', () => setContextMenu(null))
    instance.on('moveend', () => {
      lastView.current = { center: { lat: instance.getCenter().lat, lon: instance.getCenter().lng }, zoom: instance.getZoom() }
      const bounds = instance.getBounds()
      handlers.current.onViewport({ lat: instance.getCenter().lat, lon: instance.getCenter().lng }, [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()], instance.getZoom())
    })
    return () => {
      cancel()
      surface.removeEventListener('pointerdown', down, true)
      surface.removeEventListener('pointermove', move, true)
      surface.removeEventListener('pointerup', up, true)
      surface.removeEventListener('pointercancel', cancel)
      surface.removeEventListener('lostpointercapture', cancel)
      surface.removeEventListener('click', click, true)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', escape)
      lastView.current = { center: { lat: instance.getCenter().lat, lon: instance.getCenter().lng }, zoom: instance.getZoom() }
      markers.current.forEach(({ marker }) => marker.remove())
      markers.current.clear()
      locationMarker.current?.remove()
      locationMarker.current = null
      previewMarker.current?.remove()
      previewMarker.current = null
      handlers.current.onReady(null)
      instance.remove()
      if (map.current === instance) map.current = null
    }
  }, [theme])

  useEffect(() => {
    const source = map.current?.getSource('offline-map') as VectorTileSource | undefined
    source?.setTiles([`offline-map://{z}/{x}/{y}?v=${revision}`])
  }, [revision, mapLoaded])

  useEffect(() => {
    const source = map.current?.getSource('offline-coverage') as maplibregl.GeoJSONSource | undefined
    if (!source) return
    const ready = new Set(readyAreas)
    source.setData({
      type: 'FeatureCollection',
      features: (areas ?? []).map((area) => {
        const [west, south, east, north] = area.bbox
        const mapSaved = ready.has(area.id)
        const graphSaved = routingReady && !!graphCoverage && west >= graphCoverage[0] && south >= graphCoverage[1] && east <= graphCoverage[2] && north <= graphCoverage[3]
        return {
          type: 'Feature' as const,
          properties: { id: area.id, status: mapSaved ? (graphSaved ? 'both' : 'map') : (graphSaved ? 'graph' : 'missing') },
          geometry: { type: 'Polygon' as const, coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] }
        }
      })
    })
  }, [areas, readyAreas, graphCoverage, routingReady, mapLoaded])

  useEffect(() => {
    const instance = map.current
    if (!instance) return
    for (const id of ['coverage-missing', 'coverage-graph-only', 'coverage-map-only', 'coverage-both']) {
      if (instance.getLayer(id)) instance.setLayoutProperty(id, 'visibility', showCoverage ? 'visible' : 'none')
    }
  }, [showCoverage, mapLoaded])

  useEffect(() => {
    map.current?.flyTo({ center: [center.lon, center.lat], zoom: focusZoom })
  }, [center, focusZoom])

  useEffect(() => {
    const instance = map.current
    if (!instance) return
    const source = instance.getSource('route') as maplibregl.GeoJSONSource | undefined
    if (!source) return
    const next = new Map<string, Coordinate[]>()
    const add: Array<{ type: 'Feature'; id: string; properties: { afterId: string }; geometry: { type: 'LineString'; coordinates: number[][] } }> = []
    for (const leg of legs) {
      const start = waypoints[leg.index]
      const end = waypoints[leg.index + 1]
      if (!start || !end) continue
      const id = `${start.id}:${end.id}`
      next.set(id, leg.coordinates)
      if (routeFeatures.current.get(id) !== leg.coordinates) add.push({
        type: 'Feature', id, properties: { afterId: end.id },
        geometry: { type: 'LineString', coordinates: leg.coordinates.map((point) => [point.lon, point.lat]) }
      })
    }
    const remove = [...routeFeatures.current].filter(([id, coordinates]) => next.get(id) !== coordinates).map(([id]) => id)
    if (remove.length || add.length) source.updateData({ remove, add })
    routeFeatures.current = next
  }, [legs, waypoints, theme, mapLoaded])

  useEffect(() => {
    const instance = map.current
    if (!instance) return
    const active = new Set(waypoints.map((point) => point.id))
    for (const [id, { marker }] of markers.current) {
      if (!active.has(id)) { marker.remove(); markers.current.delete(id) }
    }
    waypoints.forEach((waypoint, index) => {
      const point = waypoint.snapped ?? waypoint.original
      let entry = markers.current.get(waypoint.id)
      if (!entry) {
        const element = document.createElement('button')
        element.type = 'button'
        element.dataset.waypointId = waypoint.id
        element.classList.add('waypoint-marker')
        element.addEventListener('click', (event) => event.stopPropagation())
        element.addEventListener('contextmenu', (event) => {
          event.preventDefault()
          event.stopPropagation()
          const waypointNumber = waypointsRef.current.findIndex((item) => item.id === waypoint.id) + 1
          if (!waypointNumber) return
          const bounds = container.current?.getBoundingClientRect()
          setContextMenu({ kind: 'remove', waypointId: waypoint.id, waypointNumber, ...menuPosition(event.clientX - (bounds?.left ?? 0), event.clientY - (bounds?.top ?? 0)) })
        })
        const marker = new maplibregl.Marker({ element, draggable: false, anchor: 'center' })
          .setLngLat([point.lon, point.lat]).addTo(instance)
        entry = { marker, element, point }
        markers.current.set(waypoint.id, entry)
      }
      entry.element.classList.toggle('first', index === 0)
      entry.element.style.visibility = preview?.kind === 'move' && preview.waypoint.id === waypoint.id ? 'hidden' : ''
      const number = index + 1 + (preview?.kind === 'insert' && index >= preview.waypointIndex ? 1 : 0)
      entry.element.textContent = String(number)
      entry.element.setAttribute('aria-label', `Waypoint ${number}, drag to move`)
      const displayed = entry.marker.getLngLat()
      if (displayed.lat !== point.lat || displayed.lng !== point.lon) {
        entry.marker.setLngLat([point.lon, point.lat])
        entry.point = point
      }
    })
  }, [waypoints, theme, revision, mapLoaded, preview?.waypointIndex, preview?.kind])

  useEffect(() => {
    const instance = map.current
    if (!instance) return
    if (!preview) { previewMarker.current?.remove(); previewMarker.current = null; return }
    if (!previewMarker.current) {
      const element = document.createElement('div')
      element.classList.add('waypoint-marker', 'waypoint-preview')
      previewMarker.current = new maplibregl.Marker({ element, anchor: 'center' }).setLngLat([0, 0]).addTo(instance)
    }
    const element = previewMarker.current.getElement()
    element.classList.toggle('first', preview.waypointIndex === 0)
    element.textContent = String(preview.waypointIndex + 1)
    element.setAttribute('aria-label', `${preview.kind === 'move' ? 'Moving' : 'New'} waypoint ${preview.waypointIndex + 1}`)
    const point = preview.waypoint.snapped ?? preview.waypoint.original
    previewMarker.current.setLngLat([point.lon, point.lat])
  }, [preview?.waypoint, mapLoaded])

  useEffect(() => {
    const instance = map.current
    if (!instance?.getLayer('preview-line')) return
    const source = instance.getSource('route-preview') as maplibregl.GeoJSONSource
    const affected = preview?.legs?.filter((leg) => leg.index === preview.waypointIndex - 1 || leg.index === preview.waypointIndex) ?? []
    source.setData({ type: 'FeatureCollection', features: affected.map((leg) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: leg.coordinates.map((point) => [point.lon, point.lat]) } })) })
    const afterIds = affected.length && preview ? (preview.kind === 'insert'
      ? [waypoints[preview.waypointIndex]?.id]
      : [preview.waypointIndex > 0 ? waypoints[preview.waypointIndex]?.id : undefined, waypoints[preview.waypointIndex + 1]?.id]).filter((id): id is string => !!id) : []
    for (const layer of ['route-line', 'route-halo', 'route-hit']) {
      instance.setFilter(layer, afterIds.length ? ['!', ['in', ['get', 'afterId'], ['literal', afterIds]]] : null)
    }
  }, [preview?.legs, preview?.waypointIndex, preview?.kind, waypoints, mapLoaded])

  useEffect(() => {
    const instance = map.current
    if (!preview || !instance?.getLayer('preview-line')) return
    let frame = 0
    let previousStep = -1
    const animate = (time: number) => {
      const step = Math.floor(time / 70) % 12
      if (step !== previousStep) {
        const phase = step / 4
        // Rotate a repeating two-unit dash and one-unit gap without changing its length.
        instance.setPaintProperty('preview-line', 'line-dasharray', phase <= 1 ? [0, phase, 2, 1 - phase] : [phase - 1, 1, 3 - phase, 0])
        previousStep = step
      }
      frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [!!preview, mapLoaded])

  useEffect(() => {
    const instance = map.current
    locationMarker.current?.remove()
    locationMarker.current = null
    if (!instance || !currentLocation) return
    const element = document.createElement('div')
    element.className = 'location-dot'
    element.setAttribute('aria-label', 'Your location')
    locationMarker.current = new maplibregl.Marker({ element, anchor: 'center' })
      .setLngLat([currentLocation.lon, currentLocation.lat]).addTo(instance)
    return () => { locationMarker.current?.remove(); locationMarker.current = null }
  }, [currentLocation, theme, mapLoaded])

  return <div className="map-surface">
    <div ref={container} className="map-canvas" aria-label="Route map" />
    {contextMenu && <div ref={menuElement} className="map-context-menu" role="menu" aria-label={contextMenu.kind === 'add' ? 'Route options' : 'Waypoint options'} style={{ left: contextMenu.x, top: contextMenu.y }} onContextMenu={(event) => event.preventDefault()}>
      <span className="map-context-heading">{contextMenu.kind === 'add' ? (contextMenu.beforeNumber ? `Between stops ${contextMenu.beforeNumber} and ${contextMenu.beforeNumber + 1}` : 'At the end of your route') : `Waypoint ${contextMenu.waypointNumber}`}</span>
      {contextMenu.kind === 'add' ? <button ref={menuButton} type="button" role="menuitem" onClick={() => {
        const insertionIndex = contextMenu.afterId ? waypointsRef.current.findIndex((point) => point.id === contextMenu.afterId) : -1
        handlers.current.onMapClick(contextMenu.point, insertionIndex >= 0 ? insertionIndex : undefined)
        setContextMenu(null)
      }}><Plus size={17} /> Add waypoint</button> : <button ref={menuButton} type="button" role="menuitem" className="danger" onClick={() => {
        handlers.current.onRemovePoint(contextMenu.waypointId)
        setContextMenu(null)
      }}><Trash2 size={17} /> Remove waypoint</button>}
    </div>}
  </div>
}
