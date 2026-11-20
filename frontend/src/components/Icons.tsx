import type { DroneStatus, MissionStatus, RequestStatus } from '../types';

interface IconProps {
  className?: string;
}

const stroke = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: 'false',
} as const;

export function IconDrone({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <circle cx="3.4" cy="3.4" r="1.9" />
      <circle cx="12.6" cy="3.4" r="1.9" />
      <circle cx="3.4" cy="12.6" r="1.9" />
      <circle cx="12.6" cy="12.6" r="1.9" />
      <rect x="6" y="6" width="4" height="4" rx="1.1" />
      <path d="M4.8 4.8 6.4 6.4M11.2 4.8 9.6 6.4M4.8 11.2 6.4 9.6M11.2 11.2 9.6 9.6" />
    </svg>
  );
}

export function IconPlot({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <rect x="2.4" y="3.2" width="11.2" height="9.6" rx="1.4" />
      <path d="M5.2 3.2v9.6M8 3.2v9.6M10.8 3.2v9.6" />
    </svg>
  );
}

export function IconBattery({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <rect x="1.6" y="4.6" width="11" height="6.8" rx="1.7" />
      <path d="M14.4 6.7v2.6" />
      <path d="M4 7.1h4.6v1.8H4z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconClock({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <circle cx="8" cy="8" r="5.4" />
      <path d="M8 4.8V8l2.1 1.3" />
    </svg>
  );
}

export function IconClose({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" />
    </svg>
  );
}

export function IconPlus({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M8 3.2v9.6M3.2 8h9.6" />
    </svg>
  );
}

export function IconMinus({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M3.2 8h9.6" />
    </svg>
  );
}

export function IconTarget({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <circle cx="8" cy="8" r="4.4" />
      <path d="M8 1.2v2.4M8 12.4v2.4M1.2 8h2.4M12.4 8h2.4M8 8h.01" />
    </svg>
  );
}

export function IconArrowUpRight({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M4 12 12 4M6 4h6v6" />
    </svg>
  );
}

export function IconReturn({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M3.4 6.2H10a3.2 3.2 0 0 1 0 6.4H7.2" />
      <path d="M6 3.6 3.4 6.2 6 8.8" />
    </svg>
  );
}

export function IconSpray({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M8 2.4c0 0-3.1 3.7-3.1 5.9a3.1 3.1 0 0 0 6.2 0C11.1 6.1 8 2.4 8 2.4Z" />
      <path d="M3.2 13.4h1.4M7.3 13.4h1.4M11.4 13.4h1.4" opacity=".65" />
    </svg>
  );
}

export function IconCheck({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M2.8 8.4 6.1 11.7 13.2 4.4" />
    </svg>
  );
}

export function IconAlert({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M8 2.4 14.2 13H1.8L8 2.4Z" />
      <path d="M8 6.2v3.1M8 11.4h.01" />
    </svg>
  );
}

export function IconInfo({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 7.2v3.4M8 5.2h.01" />
    </svg>
  );
}

export function IconTrash({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M2.8 4.6h10.4M6.2 4.6V3.1h3.6v1.5M4.2 4.6l.7 8.3h6.2l.7-8.3" />
      <path d="M6.7 7v3.6M9.3 7v3.6" opacity=".7" />
    </svg>
  );
}

export function IconPencil({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M10.8 2.8 13.2 5.2 5.6 12.8l-3.1.5.5-3.1 7.8-7.4Z" />
      <path d="M9.4 4.2l2.4 2.4" />
    </svg>
  );
}

export function IconRefresh({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M13.2 8a5.2 5.2 0 1 1-1.5-3.7" />
      <path d="M13.4 2.6v3.2h-3.2" />
    </svg>
  );
}

export function IconChevron({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M4 6.2 8 10.2l4-4" />
    </svg>
  );
}

export function IconLayers({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M8 2.2 14 5.6 8 9 2 5.6l6-3.4Z" />
      <path d="M2.6 8.6 8 11.8l5.4-3.2M2.6 11.4 8 14.6l5.4-3.2" opacity=".6" />
    </svg>
  );
}

export function IconRadius({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <circle cx="8" cy="8" r="5.8" strokeDasharray="2 2.2" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconSignal({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M2.4 6.4a8 8 0 0 1 11.2 0M4.8 9a4.6 4.6 0 0 1 6.4 0" />
      <path d="M8 11.6h.01" />
    </svg>
  );
}

export function StatusGlyph({ status }: { status: DroneStatus }) {
  switch (status) {
    case 'idle':
      return (
        <svg {...stroke}>
          <circle cx="8" cy="8" r="3.4" />
        </svg>
      );
    case 'assigned':
      return (
        <svg {...stroke}>
          <rect x="4.4" y="4.4" width="7.2" height="7.2" rx="1.5" />
        </svg>
      );
    case 'enroute':
      return <IconArrowUpRight />;
    case 'spraying':
      return <IconSpray />;
    case 'returning':
      return <IconReturn />;
  }
}

export function MissionGlyph({ status }: { status: MissionStatus }) {
  if (status === 'done') return <IconCheck />;
  return <StatusGlyph status={status} />;
}

export function RequestGlyph({ status }: { status: RequestStatus }) {
  switch (status) {
    case 'queued':
      return <IconClock />;
    case 'assigned':
      return <IconArrowUpRight />;
    case 'done':
      return <IconCheck />;
    case 'cancelled':
      return <IconClose />;
  }
}

export function BrandMark({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden focusable="false">
      <circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" strokeWidth="1.1" opacity=".38" />
      <circle cx="16" cy="16" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="16" cy="16" r="2" fill="currentColor" />
      <path
        d="M16 1.6v5M16 25.4v5M1.6 16h5M25.4 16h5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="6" cy="6" r="1.5" fill="currentColor" opacity=".5" />
      <circle cx="26" cy="6" r="1.5" fill="currentColor" opacity=".5" />
      <circle cx="6" cy="26" r="1.5" fill="currentColor" opacity=".5" />
      <circle cx="26" cy="26" r="1.5" fill="currentColor" opacity=".5" />
    </svg>
  );
}
