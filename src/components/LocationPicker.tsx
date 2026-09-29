import { useEffect, useRef, useState } from 'react'
import { MapPin, X } from 'lucide-react'
import { popularAreas, searchAddresses, type SearchResult } from '../lib/location'
import type { Coordinate } from '../lib/types'

type Props = { locating: boolean; onSelect: (point: Coordinate) => void; onClose?: () => void }

export function LocationPicker({ locating, onSelect, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const request = useRef<AbortController | null>(null)
  const [area, setArea] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => { request.current?.abort(); element.close() }
  }, [])
  const resetSearch = () => {
    request.current?.abort()
    setSearching(false)
    setResults([])
    setError('')
  }
  const submit = async () => {
    if (area !== 'other') {
      const selected = popularAreas.find((entry) => entry.name === area)
      if (selected) onSelect(selected.point)
      return
    }
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setSearching(true)
    setResults([])
    setError('')
    try {
      const matches = await searchAddresses(query, controller.signal)
      if (controller.signal.aborted) return
      if (matches.length === 1) onSelect(matches[0])
      else if (matches.length) setResults(matches)
      else setError('No matching address or ZIP code in this server’s search data. Try a city or a more complete address.')
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Search failed.')
    } finally { if (!controller.signal.aborted) setSearching(false) }
  }
  return <dialog ref={dialog} className="dialog location-dialog" aria-labelledby="location-heading" onCancel={(event) => { event.preventDefault(); onClose?.() }}>
    <div className="dialog-heading"><div className="location-picker-icon"><MapPin size={24} /></div>{onClose && <button className="icon-plain" aria-label="Close area picker" onClick={onClose}><X size={20} /></button>}</div>
    <h2 id="location-heading">{locating ? 'Finding your starting point' : 'Where would you like to start?'}</h2>
    {locating ? <p role="status">Checking your device location, then your remembered location…</p> : <>
      <p>Choose a California area or search for an address or ZIP code anywhere.</p>
      <form onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <label className="field-label" htmlFor="starting-area">Starting area</label>
        <select id="starting-area" value={area} onChange={(event) => { resetSearch(); setArea(event.target.value) }} required>
          <option value="" disabled>Select an area</option>
          {popularAreas.map((entry) => <option key={entry.name}>{entry.name}</option>)}
          <option value="other">Other — address or ZIP code</option>
        </select>
        {area === 'other' && <><label className="field-label" htmlFor="starting-address">Address or ZIP code</label><input id="starting-address" placeholder="Address, city, or ZIP code" autoComplete="street-address" value={query} minLength={3} maxLength={160} required onChange={(event) => { resetSearch(); setQuery(event.target.value) }} /></>}
        {error && <p className="location-error" role="alert">{error}</p>}
        <button className="primary-button full" disabled={!area || searching || (area === 'other' && query.trim().length < 3)}>{searching ? 'Searching…' : area === 'other' ? 'Find location' : 'Open area'}</button>
      </form>
      {!!results.length && <div className="location-results" aria-label="Matching locations"><p>Select a matching location:</p>{results.map((result, index) => <button key={index} className="dialog-action" onClick={() => onSelect(result)}><span><strong>{result.name}</strong><small>{result.detail}</small></span></button>)}</div>}
      <p className="footnote">We’ll check for maps and routing data for your selection and download available packages. Search coverage depends on this server’s address data.</p>
    </>}
  </dialog>
}
