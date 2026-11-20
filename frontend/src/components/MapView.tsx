import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import type { Drone, FlyTarget, Location } from '../types';
import { BASE, CITY_LABEL, DEFAULT_ZOOM, OPERATING_RADIUS_M } from '../constants';
import { BASE_HTML, DRAFT_HTML } from '../lib/markerHtml';
import { DroneLayer } from './DroneLayer';
import { LocationLayer } from './LocationLayer';

interface MapViewProps {
  locations: Location[];
  drones: Drone[];
  selectedLocationId: string | null;
  selectedDroneId: string | null;
  placing: boolean;
  draft: { lat: number; lng: number } | null;
  flyTo: FlyTarget | null;
  onMapClick: (lat: number, lng: number) => void;
  onSelectLocation: (id: string) => void;
  onSelectDrone: (id: string) => void;
}

const RADIUS_TAG_LAT = BASE.lat + OPERATING_RADIUS_M / 111320;

export function MapView({
  locations,
  drones,
  selectedLocationId,
  selectedDroneId,
  placing,
  draft,
  flyTo,
  onMapClick,
  onSelectLocation,
  onSelectDrone,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const draftMarkerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const instance = L.map(container, {
      center: [BASE.lat, BASE.lng],
      zoom: DEFAULT_ZOOM,
      minZoom: 8,
      maxZoom: 18,
      zoomControl: false,
      zoomSnap: 0.5,
      attributionControl: true,
      preferCanvas: true,
    });

    instance.attributionControl.setPrefix(false);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    }).addTo(instance);

    L.control.zoom({ position: 'bottomright', zoomInTitle: 'Zoom in', zoomOutTitle: 'Zoom out' }).addTo(instance);

    L.circle([BASE.lat, BASE.lng], {
      radius: OPERATING_RADIUS_M,
      color: '#c9f45e',
      weight: 1.2,
      opacity: 0.55,
      dashArray: '4 7',
      fillColor: '#c9f45e',
      fillOpacity: 0.035,
      interactive: false,
    }).addTo(instance);

    L.marker([BASE.lat, BASE.lng], {
      icon: L.divIcon({
        className: 'base-div',
        html: BASE_HTML,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      }),
      keyboard: false,
      interactive: false,
      title: `Base · ${CITY_LABEL}`,
    }).addTo(instance);

    L.marker([RADIUS_TAG_LAT, BASE.lng], {
      icon: L.divIcon({
        className: 'radius-div',
        html: '<span class="radius-tag">15 km</span>',
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }),
      keyboard: false,
      interactive: false,
    }).addTo(instance);

    mapRef.current = instance;
    setMap(instance);

    return () => {
      mapRef.current = null;
      setMap(null);
      instance.remove();
    };
  }, []);

  useEffect(() => {
    if (!map) return;
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);

  useEffect(() => {
    if (!map) return;
    const container = map.getContainer();
    container.classList.toggle('is-placing', placing);
    return () => container.classList.remove('is-placing');
  }, [map, placing]);

  useEffect(() => {
    if (!map || !placing) return;
    const handler = (event: L.LeafletMouseEvent) => {
      onMapClickRef.current(event.latlng.lat, event.latlng.lng);
    };
    map.on('click', handler);
    return () => {
      map.off('click', handler);
    };
  }, [map, placing]);

  useEffect(() => {
    if (!map || !flyTo) return;
    map.flyTo([flyTo.lat, flyTo.lng], flyTo.zoom ?? Math.max(map.getZoom(), 13), {
      duration: 0.85,
      easeLinearity: 0.22,
    });
  }, [map, flyTo]);

  const draftLat = draft ? draft.lat : null;
  const draftLng = draft ? draft.lng : null;

  useEffect(() => {
    if (!map) return;
    draftMarkerRef.current?.remove();
    draftMarkerRef.current = null;
    if (draftLat == null || draftLng == null) return;
    draftMarkerRef.current = L.marker([draftLat, draftLng], {
      icon: L.divIcon({
        className: 'draft-div',
        html: DRAFT_HTML,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      }),
      keyboard: false,
      interactive: false,
      zIndexOffset: 1500,
    }).addTo(map);

    return () => {
      draftMarkerRef.current?.remove();
      draftMarkerRef.current = null;
    };
  }, [map, draftLat, draftLng]);

  return (
    <div className="map-wrap">
      <div
        ref={containerRef}
        className="map"
        role="application"
        aria-label={`Operations map of ${CITY_LABEL} and the 15 kilometre operating radius`}
      />
      <div className="map-shade" aria-hidden="true" />
      {map && (
        <>
          <LocationLayer map={map} locations={locations} selectedId={selectedLocationId} onSelect={onSelectLocation} />
          <DroneLayer map={map} drones={drones} selectedId={selectedDroneId} onSelect={onSelectDrone} />
        </>
      )}
    </div>
  );
}
