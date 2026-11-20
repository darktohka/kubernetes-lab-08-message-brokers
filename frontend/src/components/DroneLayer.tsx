import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { Drone } from '../types';
import { droneMarkerHtml } from '../lib/markerHtml';

interface DroneLayerProps {
  map: L.Map;
  drones: Drone[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

interface MarkerItem {
  marker: L.Marker;
  root: HTMLElement;
  glyph: HTMLElement;
  nameEl: HTMLElement;
  battEl: HTMLElement;
  cur: { lat: number; lng: number };
  bearing: number;
}

const SNAP_THRESHOLD_DEG = 0.02;

/**
 * DOM markers for the live fleet. Positions are interpolated with requestAnimationFrame
 * so 1 Hz telemetry reads as continuous flight instead of teleporting.
 */
export function DroneLayer({ map, drones, selectedId, onSelect }: DroneLayerProps) {
  const items = useRef(new Map<string, MarkerItem>());
  const targets = useRef(new Map<string, { lat: number; lng: number }>());
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const seen = new Set<string>();

    for (const drone of drones) {
      seen.add(drone.id);
      let item = items.current.get(drone.id);

      if (!item) {
        const marker = L.marker([drone.lat, drone.lng], {
          icon: L.divIcon({
            className: 'drone-div',
            html: droneMarkerHtml(drone),
            iconSize: [34, 34],
            iconAnchor: [17, 17],
          }),
          keyboard: true,
          title: drone.name,
          riseOnHover: true,
          zIndexOffset: 500,
          bubblingMouseEvents: false,
        }).addTo(map);

        marker.on('click', () => onSelectRef.current(drone.id));

        const element = marker.getElement();
        const root = element?.querySelector<HTMLElement>('.drone-marker');
        const glyph = element?.querySelector<HTMLElement>('.drone-glyph');
        const nameEl = element?.querySelector<HTMLElement>('.drone-label__name');
        const battEl = element?.querySelector<HTMLElement>('.drone-label__batt');
        if (!root || !glyph || !nameEl || !battEl) continue;

        item = {
          marker,
          root,
          glyph,
          nameEl,
          battEl,
          cur: { lat: drone.lat, lng: drone.lng },
          bearing: 0,
        };
        items.current.set(drone.id, item);
      }

      targets.current.set(drone.id, { lat: drone.lat, lng: drone.lng });
    }

    for (const [id, item] of items.current) {
      if (seen.has(id)) continue;
      item.marker.remove();
      items.current.delete(id);
      targets.current.delete(id);
    }
  }, [map, drones]);

  useEffect(() => {
    for (const drone of drones) {
      const item = items.current.get(drone.id);
      if (!item) continue;

      const status = drone.status;
      if (item.root.dataset.status !== status) item.root.dataset.status = status;

      const battery = `${Math.round(drone.battery)}%`;
      if (item.battEl.textContent !== battery) item.battEl.textContent = battery;
      if (item.nameEl.textContent !== drone.name) item.nameEl.textContent = drone.name;

      const selected = drone.id === selectedId;
      item.root.classList.toggle('is-selected', selected);
      item.marker.setZIndexOffset(selected ? 1200 : 500);
    }
  }, [drones, selectedId]);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const step = (now: number) => {
      const delta = Math.min(now - last, 120);
      last = now;
      const ease = 1 - Math.exp(-delta / 180);

      for (const [id, target] of targets.current) {
        const item = items.current.get(id);
        if (!item) continue;

        const dLat = target.lat - item.cur.lat;
        const dLng = target.lng - item.cur.lng;
        const distance = Math.hypot(dLat, dLng);
        if (distance < 1e-7) continue;

        const status = item.root.dataset.status;
        if (reduceMotion || distance > SNAP_THRESHOLD_DEG) {
          item.cur = { lat: target.lat, lng: target.lng };
          item.marker.setLatLng([target.lat, target.lng]);
          continue;
        }

        const nextLat = item.cur.lat + dLat * ease;
        const nextLng = item.cur.lng + dLng * ease;
        item.cur = { lat: nextLat, lng: nextLng };
        item.marker.setLatLng([nextLat, nextLng]);

        if (status === 'enroute' || status === 'returning') {
          const bearing =
            (Math.atan2(dLng * Math.cos((nextLat * Math.PI) / 180), dLat) * 180) / Math.PI;
          const smoothed = item.bearing + (bearing - item.bearing) * 0.25;
          item.bearing = smoothed;
          item.glyph.style.transform = `rotate(${smoothed.toFixed(1)}deg)`;
        } else if (item.bearing !== 0) {
          item.bearing = 0;
          item.glyph.style.transform = 'rotate(0deg)';
        }
      }

      frame = window.requestAnimationFrame(step);
    };

    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(
    () => () => {
      for (const item of items.current.values()) item.marker.remove();
      items.current.clear();
      targets.current.clear();
    },
    [],
  );

  return null;
}
