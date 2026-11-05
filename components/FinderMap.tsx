'use client';

import { useEffect, useRef, useState } from 'react';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import { FiCheck, FiMapPin, FiMaximize2, FiSearch } from 'react-icons/fi';
import { hasCoordinates, parseFinderArea, type FinderArea } from '@/lib/finder-map';

type MapBusiness = { id: string; name: string; latitude?: number; longitude?: number; importedLeadId?: string };
export type FinderAreaDetails = { locationLabel?: string; formattedAddress?: string };
type Props = {
  location: string;
  area?: FinderArea;
  radiusKm?: number;
  results?: MapBusiness[];
  selected?: string[];
  focusedId?: string;
  busy?: boolean;
  setup?: boolean;
  fitAreaKey?: string | number;
  onFocus?: (id: string) => void;
  onArea?: (area: FinderArea, details?: FinderAreaDetails) => void;
  onRadiusChange?: (radiusKm: number) => void;
};

let mapsPromise: Promise<string> | undefined;
function loadMaps() {
  if (!mapsPromise) {
    const loading = (async () => {
      const response = await fetch('/api/finder/map-config');
      if (!response.ok) throw new Error('Map unavailable');
      const config = await response.json() as { apiKey: string; mapId: string };
      if (!config.apiKey) throw new Error('Map unavailable');
      setOptions({ key: config.apiKey, v: 'weekly' });
      await Promise.all([importLibrary('maps'), importLibrary('marker'), importLibrary('geocoding')]);
      return config.mapId;
    })();
    mapsPromise = new Promise<string>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Map unavailable')), 15000);
      loading.then(value => { clearTimeout(timeout); resolve(value); }, error => { clearTimeout(timeout); reject(error); });
    }).catch(error => { mapsPromise = undefined; throw error; });
  }
  return mapsPromise;
}

const emptyResults: MapBusiness[] = [];
const emptySelection: string[] = [];
const radiusSteps = [3, 5, 10, 15, 25, 50];

function locationDetails(result?: google.maps.GeocoderResult): FinderAreaDetails {
  if (!result) return {};
  const preferredTypes = ['locality', 'postal_town', 'administrative_area_level_2', 'administrative_area_level_1'];
  const component = preferredTypes.map(type => result.address_components.find(item => item.types.includes(type))).find(Boolean);
  return { locationLabel: component?.long_name || result.formatted_address.split(',')[0], formattedAddress: result.formatted_address };
}

export function FinderMap({ location, area, radiusKm = 10, results = emptyResults, selected = emptySelection, focusedId, busy, setup, fitAreaKey = 'default', onFocus, onArea, onRadiusChange }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const circle = useRef<google.maps.Circle | null>(null);
  const markers = useRef(new Map<string, google.maps.marker.AdvancedMarkerElement>());
  const callbacks = useRef({ onFocus, onArea });
  useEffect(() => { callbacks.current = { onFocus, onArea }; }, [onFocus, onArea]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [moved, setMoved] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const currentArea = useRef(area);
  const userMoving = useRef(false);
  const programmatic = useRef(false);
  const lastFitKey = useRef<string | number | undefined>(undefined);
  const lastFocused = useRef<string | undefined>(undefined);
  const areaKey = area ? JSON.stringify(area) : '';

  useEffect(() => { currentArea.current = area; }, [area]);

  const fit = (target: google.maps.LatLngBounds | google.maps.LatLngBoundsLiteral) => {
    if (!map.current) return;
    programmatic.current = true;
    map.current.fitBounds(target, 28);
    google.maps.event.addListenerOnce(map.current, 'idle', () => { programmatic.current = false; });
  };

  useEffect(() => {
    let disposed = false;
    let resize: ResizeObserver | undefined;
    const listeners: google.maps.MapsEventListener[] = [];
    loadMaps().then(mapId => {
      if (disposed || !container.current) return;
      const instance = new google.maps.Map(container.current, {
        mapId, center: { lat: 12, lng: 123 }, zoom: 5, mapTypeControl: false,
        streetViewControl: false, fullscreenControl: false, gestureHandling: 'cooperative',
      });
      map.current = instance;
      circle.current = new google.maps.Circle({
        map: instance, strokeColor: '#26765d', strokeWeight: 2, fillColor: '#26765d', fillOpacity: 0.1, clickable: false,
      });
      const initialArea = currentArea.current;
      if (initialArea && hasCoordinates(initialArea) && Number.isFinite(initialArea.radiusKm)) {
        circle.current.setCenter({ lat: initialArea.latitude, lng: initialArea.longitude });
        circle.current.setRadius(initialArea.radiusKm * 1000);
        google.maps.event.addListenerOnce(instance, 'idle', () => {
          const bounds = circle.current?.getBounds();
          if (bounds) fit(bounds);
        });
      }
      let wasVisible = false;
      resize = new ResizeObserver(entries => {
        const visible = entries[0].contentRect.width > 0 && entries[0].contentRect.height > 0;
        if (visible && !wasVisible) google.maps.event.trigger(instance, 'resize');
        wasVisible = visible;
      });
      resize.observe(container.current);
      listeners.push(instance.addListener('dragstart', () => { userMoving.current = true; setMoved(true); }));
      listeners.push(instance.addListener('zoom_changed', () => {
        if (!programmatic.current) { userMoving.current = true; setMoved(true); }
      }));
      listeners.push(instance.addListener('center_changed', () => {
        if (userMoving.current && !programmatic.current) {
          const center = instance.getCenter();
          if (center) circle.current?.setCenter(center);
        }
      }));
      listeners.push(instance.addListener('idle', () => { userMoving.current = false; }));
      setError(''); setReady(true);
    }).catch(() => { if (!disposed) setError('The map is unavailable right now. You can still find and review businesses in the list.'); });
    return () => {
      disposed = true;
      resize?.disconnect();
      listeners.forEach(listener => listener?.remove());
      circle.current?.setMap(null); circle.current = null;
      map.current = null;
    };
  }, [attempt]);

  useEffect(() => {
    if (!ready || !map.current || !circle.current) return;
    let disposed = false;
    const selectedArea = area && hasCoordinates(area) && Number.isFinite(area.radiusKm)
      ? { latitude: area.latitude, longitude: area.longitude, radiusKm: area.radiusKm }
      : parseFinderArea(areaKey);
    if (selectedArea) {
      if (!moved) circle.current.setCenter({ lat: selectedArea.latitude, lng: selectedArea.longitude });
      circle.current.setRadius((setup ? radiusKm : selectedArea.radiusKm) * 1000);
      if (lastFitKey.current !== fitAreaKey) {
        const bounds = circle.current.getBounds();
        if (bounds) fit(bounds);
        lastFitKey.current = fitAreaKey;
      }
      return;
    }
    if (!location.trim()) return;
    const timer = window.setTimeout(async () => {
      setMoved(false); setLocationError(''); setLocating(true);
      try {
        const response = await new google.maps.Geocoder().geocode({ address: location });
        if (disposed) return;
        const place = response.results[0];
        if (!place) throw new Error('Location not found');
        const center = place.geometry.location;
        const nextArea = { latitude: center.lat(), longitude: center.lng(), radiusKm };
        circle.current?.setCenter(center); circle.current?.setRadius(radiusKm * 1000);
        const bounds = circle.current?.getBounds();
        if (bounds) fit(bounds);
        lastFitKey.current = fitAreaKey;
        if (setup) callbacks.current.onArea?.(nextArea);
      } catch { if (!disposed) setLocationError('Could not locate this area. Refine the location or move the map to choose an area.'); }
      finally { if (!disposed) setLocating(false); }
    }, 450);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [ready, location, area, areaKey, radiusKm, setup, fitAreaKey, moved]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const markerStore = markers.current;
    const instances = results.filter(hasCoordinates).map(result => {
      const pin = new google.maps.marker.PinElement({ background: '#26765d', borderColor: '#fff', glyphColor: '#fff' });
      const marker = new google.maps.marker.AdvancedMarkerElement({
        position: { lat: result.latitude, lng: result.longitude }, title: result.name, content: pin.element,
      });
      marker.addListener('click', () => callbacks.current.onFocus?.(result.id));
      markerStore.set(result.id, marker);
      return marker;
    });
    const cluster = new MarkerClusterer({ map: map.current, markers: instances });
    return () => { cluster.clearMarkers(); cluster.setMap(null); instances.forEach(marker => { google.maps.event.clearInstanceListeners(marker); marker.map = null; }); markerStore.clear(); };
  }, [ready, results]);

  useEffect(() => {
    if (!ready) return;
    for (const result of results) {
      const marker = markers.current.get(result.id);
      if (!marker) continue;
      const active = focusedId === result.id;
      marker.content = new google.maps.marker.PinElement({
        background: active ? '#172b35' : selected.includes(result.id) ? '#1766ba' : result.importedLeadId ? '#718078' : '#26765d',
        borderColor: '#fff', glyphColor: '#fff', scale: active ? 1.25 : 1,
      }).element;
      marker.zIndex = active ? 1000 : 1;
      if (active && focusedId !== lastFocused.current && hasCoordinates(result)) {
        programmatic.current = true;
        map.current?.panTo({ lat: result.latitude, lng: result.longitude });
        if ((map.current?.getZoom() || 0) < 16) map.current?.setZoom(16);
        if (map.current) google.maps.event.addListenerOnce(map.current, 'idle', () => { programmatic.current = false; });
      }
    }
    lastFocused.current = focusedId;
  }, [ready, focusedId, selected, results]);

  const missing = results.filter(result => !hasCoordinates(result)).length;
  const showAll = () => {
    const positions = results.filter(hasCoordinates);
    if (positions.length) {
      const bounds = new google.maps.LatLngBounds();
      positions.forEach(result => bounds.extend({ lat: result.latitude, lng: result.longitude }));
      fit(bounds);
    } else if (circle.current?.getBounds()) fit(circle.current.getBounds()!);
  };

  const changeRadius = (step: number) => {
    const nextRadius = radiusSteps[step] || 10;
    circle.current?.setRadius(nextRadius * 1000);
    onRadiusChange?.(nextRadius);
  };

  const commitViewport = async () => {
    const center = map.current?.getCenter();
    if (!center) return;
    const nextArea = { latitude: center.lat(), longitude: center.lng(), radiusKm: currentArea.current?.radiusKm || radiusKm };
    circle.current?.setCenter(center); circle.current?.setRadius(nextArea.radiusKm * 1000);
    setLocating(true); setLocationError('');
    let details: FinderAreaDetails = {};
    try {
      const response = await new google.maps.Geocoder().geocode({ location: center });
      details = locationDetails(response.results[0]);
    } catch {
      details = { locationLabel: `Map area at ${nextArea.latitude.toFixed(4)}, ${nextArea.longitude.toFixed(4)}` };
    } finally {
      setLocating(false); setMoved(false); userMoving.current = false;
    }
    callbacks.current.onArea?.(nextArea, details);
  };

  const radiusIndex = Math.max(0, radiusSteps.indexOf(radiusKm));
  return <section className={`finder-map ${setup ? 'finder-map-setup' : ''}`} aria-label="Business map">
    <div className="finder-map-stage">
      <div className="finder-map-canvas" ref={container} />
      {!ready && !error && <div className="finder-map-placeholder" role="status"><FiMapPin /><strong>Loading map…</strong></div>}
      {error && <div className="finder-map-placeholder" role="status"><FiMapPin /><strong>Map unavailable</strong><p>{error}</p><button className="secondary" onClick={() => { setError(''); setReady(false); setAttempt(value => value + 1); }}>Try again</button></div>}
      {ready && <>
        <div className="finder-map-caption"><FiMapPin /><span>{location || 'Choose a location'}<small>{locating ? 'Updating location…' : setup ? `${area?.radiusKm || radiusKm} km radius · drag the map to adjust` : `${results.length - missing} mapped businesses within ${area?.radiusKm || radiusKm} km`}</small></span></div>
        {onArea && <div className="finder-map-crosshair" aria-hidden="true"><i /><b /></div>}
        <button className="finder-map-fit" onClick={showAll} aria-label="Fit search area and results" title="Fit results"><FiMaximize2 /></button>
        {locationError && <div className="finder-map-message" role="status">{locationError}</div>}
        {!locationError && missing > 0 && <div className="finder-map-message">{missing} business{missing === 1 ? '' : 'es'} without coordinates · available in the list</div>}
      </>}
    </div>
    {ready && onArea && <footer className={`finder-map-controls ${setup ? 'with-radius' : ''}`}>
      {setup && onRadiusChange ? <div className="finder-radius-slider">
        <div><span>Radius</span><strong>{radiusKm} km</strong></div>
        <input aria-label="Search radius" aria-valuetext={`${radiusKm} kilometers`} type="range" min="0" max={radiusSteps.length - 1} step="1" value={radiusIndex} onChange={event => changeRadius(Number(event.target.value))} />
        <div className="finder-radius-ticks" aria-hidden="true">{radiusSteps.map(value => <span key={value}>{value}</span>)}</div>
      </div> : <span className="finder-map-control-hint">Drag the map to choose a new search center.</span>}
      <button className={moved ? 'primary' : 'secondary'} disabled={busy || locating || !moved} onClick={commitViewport}>{locating ? <><span className="finder-spinner" /> Applying…</> : moved ? <><FiSearch /> Apply map area</> : <><FiCheck /> Area applied</>}</button>
    </footer>}
  </section>;
}
