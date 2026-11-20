const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

const DRONE_PATH = `
  <circle cx="3.4" cy="3.4" r="1.9" />
  <circle cx="12.6" cy="3.4" r="1.9" />
  <circle cx="3.4" cy="12.6" r="1.9" />
  <circle cx="12.6" cy="12.6" r="1.9" />
  <rect x="6" y="6" width="4" height="4" rx="1.1" />
  <path d="M4.8 4.8 6.4 6.4M11.2 4.8 9.6 6.4M4.8 11.2 6.4 9.6M11.2 11.2 9.6 9.6" />
  <path d="M8 0.6 10 3.2H6L8 .6Z" fill="currentColor" stroke="none" />
`;

function svg(body: string, size = 16): string {
  return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

export interface DroneMarkerInput {
  id: string;
  name: string;
  status: string;
  battery: number;
}

export function droneMarkerHtml(drone: DroneMarkerInput): string {
  return `
    <div class="drone-marker" data-status="${escapeHtml(drone.status)}">
      <div class="drone-glyph">${svg(DRONE_PATH, 17)}</div>
      <div class="drone-label">
        <span class="drone-label__name">${escapeHtml(drone.name)}</span>
        <span class="drone-label__sep">·</span>
        <span class="drone-label__batt">${Math.round(drone.battery)}%</span>
      </div>
    </div>
  `;
}

export interface PlotMarkerInput {
  name: string;
  areaHectares: number;
  selected: boolean;
}

export function plotMarkerHtml(plot: PlotMarkerInput): string {
  const area = plot.areaHectares % 1 === 0 ? plot.areaHectares.toFixed(0) : plot.areaHectares.toFixed(1);
  return `
    <div class="plot-marker${plot.selected ? ' is-selected' : ''}">
      <span class="plot-glyph">${svg(
        '<rect x="2.4" y="3.2" width="11.2" height="9.6" rx="1.4" /><path d="M5.2 3.2v9.6M8 3.2v9.6M10.8 3.2v9.6" />',
        14,
      )}</span>
      <span class="plot-label">
        <span class="plot-label__name">${escapeHtml(plot.name)}</span>
        <span class="plot-label__meta">${area} ha</span>
      </span>
    </div>
  `;
}

export const BASE_HTML = `
  <div class="base-marker">
    <span class="base-marker__ring"></span>
    <span class="base-marker__label">BASE</span>
  </div>
`;

export const DRAFT_HTML = `
  <div class="draft-marker">
    <span class="draft-marker__ring"></span>
    <span class="draft-marker__dot"></span>
  </div>
`;
