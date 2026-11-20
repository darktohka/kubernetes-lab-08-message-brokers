const time = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const dayTime = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function fmtTime(iso: string | null | undefined): string {
  const date = parse(iso);
  return date ? time.format(date) : '—';
}

export function fmtWindow(startIso: string, endIso: string): string {
  const start = parse(startIso);
  const end = parse(endIso);
  if (!start || !end) return '—';
  const sameDay = start.toDateString() === end.toDateString();
  return sameDay
    ? `${time.format(start)} – ${time.format(end)}`
    : `${dayTime.format(start)} – ${dayTime.format(end)}`;
}

export function fmtRelative(iso: string | null | undefined): string {
  const date = parse(iso);
  if (!date) return '';
  const diffMin = Math.round((date.getTime() - Date.now()) / 60000);
  if (Math.abs(diffMin) < 1) return 'now';
  if (diffMin > 0) {
    if (diffMin < 60) return `in ${diffMin} min`;
    return `in ${Math.round(diffMin / 60)} h`;
  }
  const past = Math.abs(diffMin);
  if (past < 60) return `${past} min ago`;
  return `${Math.round(past / 60)} h ago`;
}

export function fmtCoord(lat: number, lng: number, precision = 4): string {
  return `${lat.toFixed(precision)}, ${lng.toFixed(precision)}`;
}

export function fmtArea(hectares: number | null | undefined): string {
  if (hectares == null || !Number.isFinite(hectares)) return '—';
  return `${hectares % 1 === 0 ? hectares.toFixed(0) : hectares.toFixed(1)} ha`;
}

export function fmtBattery(level: number | null | undefined): string {
  return level == null ? '—' : `${Math.round(level)}%`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function clockNow(): string {
  const now = new Date();
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
