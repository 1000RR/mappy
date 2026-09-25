import { useEffect, useRef, useState } from 'react'
import maplibregl, { type Map as MaplibreMap, type StyleSpecification, type VectorTileSource } from 'maplibre-gl'
import { DARK, LIGHT, layers, type Flavor } from '@protomaps/basemaps'
import { getMapTile } from '../lib/data'
import type { Coordinate, Leg, MapArea, Theme, Waypoint } from '../lib/types'

let protocolAdded = false

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
      bay: {
        type: 'vector',
        tiles: [`bay://{z}/{x}/{y}?v=${revision}`],
        minzoom: 0,
        maxzoom: 15,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a> · <a href="https://protomaps.com" target="_blank">Protomaps</a>'
      }
    },
    layers: layers('bay', flavor, { lang: 'en' })
  }
}

type Props = {
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
  onDragPoint: (id: string, point: Coordinate) => void
  onViewport: (center: Coordinate, bounds: [number, number, number, number], zoom: number) => void
  onReady: (map: MaplibreMap | null) => void
}

export function MapCanvas({ theme, center, focusZoom, currentLocation, waypoints, legs, revision, areas, readyAreas, graphCoverage, routingReady, showCoverage, onMapClick, onDragPoint, onViewport, onReady }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MaplibreMap | null>(null)
  const lastView = useRef({ center, zoom: focusZoom })
  const [mapLoaded, setMapLoaded] = useState(0)
  const markers = useRef<maplibregl.Marker[]>([])
  const locationMarker = useRef<maplibregl.Marker | null>(null)
  const handlers = useRef({ onMapClick, onDragPoint, onViewport, onReady })
  handlers.current = { onMapClick, onDragPoint, onViewport, onReady }

  useEffect(() => {
    if (!container.current) return
    if (!protocolAdded) {
      maplibregl.addProtocol('bay', async (params, abort) => {
        const match = params.url.match(/^bay:\/\/(\d+)\/(\d+)\/(\d+)/)
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
      minZoom: 7,
      maxZoom: 19,
      attributionControl: false,
      pitchWithRotate: false,
      dragRotate: false
    })
    map.current = instance
    instance.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    instance.on('load', () => {
      instance.addSource('offline-coverage', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      instance.addLayer({ id: 'coverage-missing', type: 'fill', source: 'offline-coverage', filter: ['==', ['get', 'status'], 'missing'], paint: { 'fill-color': theme === 'dark' ? '#0b1520' : '#aab3bd', 'fill-opacity': theme === 'dark' ? 0.56 : 0.42 } })
      instance.addLayer({ id: 'coverage-graph-only', type: 'fill', source: 'offline-coverage', filter: ['==', ['get', 'status'], 'graph'], paint: { 'fill-color': theme === 'dark' ? '#142b34' : '#9aafb7', 'fill-opacity': theme === 'dark' ? 0.55 : 0.4 } })
      instance.addLayer({ id: 'coverage-map-only', type: 'line', source: 'offline-coverage', filter: ['==', ['get', 'status'], 'map'], paint: { 'line-color': '#e49b4b', 'line-width': 2.5, 'line-opacity': 0.94 } })
      instance.addLayer({ id: 'coverage-both', type: 'line', source: 'offline-coverage', filter: ['==', ['get', 'status'], 'both'], paint: { 'line-color': theme === 'dark' ? '#78b9ff' : '#315efb', 'line-width': 2.8, 'line-opacity': 0.94 } })
      instance.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      instance.addLayer({ id: 'route-halo', type: 'line', source: 'route', paint: { 'line-color': theme === 'dark' ? '#102537' : '#ffffff', 'line-width': 10, 'line-opacity': 0.94 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
      instance.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': theme === 'dark' ? '#63adff' : '#315efb', 'line-width': 6 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
      instance.addLayer({ id: 'route-hit', type: 'line', source: 'route', paint: { 'line-color': '#000000', 'line-width': 24, 'line-opacity': 0 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
      setMapLoaded((value) => value + 1)
      handlers.current.onReady(instance)
      const bounds = instance.getBounds()
      handlers.current.onViewport({ lat: instance.getCenter().lat, lon: instance.getCenter().lng }, [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()], instance.getZoom())
    })
    instance.on('click', (event) => {
      const hit = instance.getLayer('route-hit') ? instance.queryRenderedFeatures(event.point, { layers: ['route-hit'] })[0] : undefined
      handlers.current.onMapClick({ lat: event.lngLat.lat, lon: event.lngLat.lng }, hit ? Number(hit.properties?.index) + 1 : undefined)
    })
    instance.on('moveend', () => {
      lastView.current = { center: { lat: instance.getCenter().lat, lon: instance.getCenter().lng }, zoom: instance.getZoom() }
      const bounds = instance.getBounds()
      handlers.current.onViewport({ lat: instance.getCenter().lat, lon: instance.getCenter().lng }, [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()], instance.getZoom())
    })
    return () => {
      lastView.current = { center: { lat: instance.getCenter().lat, lon: instance.getCenter().lng }, zoom: instance.getZoom() }
      markers.current.forEach((marker) => marker.remove())
      markers.current = []
      locationMarker.current?.remove()
      locationMarker.current = null
      handlers.current.onReady(null)
      instance.remove()
      if (map.current === instance) map.current = null
    }
  }, [theme])

  useEffect(() => {
    const source = map.current?.getSource('bay') as VectorTileSource | undefined
    source?.setTiles([`bay://{z}/{x}/{y}?v=${revision}`])
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
    source.setData({
      type: 'FeatureCollection',
      features: legs.map((leg) => ({
        type: 'Feature',
        properties: { index: leg.index },
        geometry: { type: 'LineString', coordinates: leg.coordinates.map((point) => [point.lon, point.lat]) }
      }))
    })
  }, [legs, theme, revision, mapLoaded])

  useEffect(() => {
    const instance = map.current
    if (!instance) return
    markers.current.forEach((marker) => marker.remove())
    markers.current = waypoints.map((waypoint, index) => {
      const element = document.createElement('button')
      element.className = `waypoint-marker ${index === 0 ? 'first' : ''}`
      element.type = 'button'
      element.textContent = String(index + 1)
      element.setAttribute('aria-label', `Waypoint ${index + 1}, drag to move`)
      element.addEventListener('click', (event) => event.stopPropagation())
      const marker = new maplibregl.Marker({ element, draggable: true, anchor: 'center' })
        .setLngLat([(waypoint.snapped ?? waypoint.original).lon, (waypoint.snapped ?? waypoint.original).lat])
        .addTo(instance)
      marker.on('dragend', () => {
        const point = marker.getLngLat()
        handlers.current.onDragPoint(waypoint.id, { lat: point.lat, lon: point.lng })
      })
      return marker
    })
    return () => { markers.current.forEach((marker) => marker.remove()); markers.current = [] }
  }, [waypoints, theme, revision, mapLoaded])

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
  }, [currentLocation, theme, revision, mapLoaded])

  return <div ref={container} className="map-canvas" aria-label="Bay Area map" />
}
