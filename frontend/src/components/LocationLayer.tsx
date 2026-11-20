import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { Location } from '../types';
import { plotMarkerHtml } from '../lib/markerHtml';

interface LocationLayerProps {
  map: L.Map;
  locations: Location[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function LocationLayer({ map, locations, selectedId, onSelect }: LocationLayerProps) {
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const group = L.layerGroup().addTo(map);

    for (const location of locations) {
      const marker = L.marker([location.lat, location.lng], {
        icon: L.divIcon({
          className: 'plot-div',
          html: plotMarkerHtml({
            name: location.name,
            areaHectares: location.areaHectares,
            selected: location.id === selectedId,
          }),
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
        keyboard: true,
        title: `${location.name} · ${location.areaHectares} ha`,
        riseOnHover: true,
        zIndexOffset: location.id === selectedId ? 900 : 200,
        bubblingMouseEvents: false,
      });

      marker.on('click', () => onSelectRef.current(location.id));
      marker.addTo(group);
    }

    return () => {
      group.remove();
    };
  }, [map, locations, selectedId]);

  return null;
}
