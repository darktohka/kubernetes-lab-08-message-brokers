import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Connection, DroneStatus, MissionStatus, RequestStatus, ToastItem, ToastTone } from '../types';
import {
  IconAlert,
  IconBattery,
  IconCheck,
  IconClose,
  IconInfo,
  IconRefresh,
  MissionGlyph,
  RequestGlyph,
  StatusGlyph,
} from './Icons';

const DRONE_LABEL: Record<DroneStatus, string> = {
  idle: 'Idle',
  assigned: 'Assigned',
  enroute: 'En route',
  spraying: 'Spraying',
  returning: 'Returning',
};

const MISSION_LABEL: Record<MissionStatus, string> = {
  ...DRONE_LABEL,
  done: 'Done',
};

const REQUEST_LABEL: Record<RequestStatus, string> = {
  queued: 'Queued',
  assigned: 'Assigned',
  done: 'Done',
  cancelled: 'Cancelled',
};

export function DroneStatusPill({ status }: { status: DroneStatus }) {
  return (
    <span className="pill" data-status={status} data-kind="drone">
      <span className="pill__glyph">
        <StatusGlyph status={status} />
      </span>
      {DRONE_LABEL[status]}
    </span>
  );
}

export function MissionStatusPill({ status }: { status: MissionStatus }) {
  return (
    <span className="pill" data-status={status} data-kind="mission">
      <span className="pill__glyph">
        <MissionGlyph status={status} />
      </span>
      {MISSION_LABEL[status]}
    </span>
  );
}

export function RequestStatusPill({ status }: { status: RequestStatus }) {
  return (
    <span className="pill" data-status={status} data-kind="request">
      <span className="pill__glyph">
        <RequestGlyph status={status} />
      </span>
      {REQUEST_LABEL[status]}
    </span>
  );
}

export function BatteryMeter({ level }: { level: number }) {
  const value = Math.max(0, Math.min(100, Math.round(level)));
  const band = value <= 20 ? 'low' : value <= 45 ? 'mid' : 'high';
  return (
    <div className="battery" data-band={band} title={`Battery ${value}%`}>
      <IconBattery className="battery__icon" />
      <span className="battery__track">
        <span className="battery__fill" style={{ width: `${value}%` }} />
      </span>
      <span className="battery__value">{value}%</span>
    </div>
  );
}

export function ProgressBar({ value, status }: { value: number; status: MissionStatus }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="progress-row">
      <div className="progress" data-status={status} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span className="progress__fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="progress__value">{pct}%</span>
    </div>
  );
}

export function SectionHead({
  label,
  count,
  action,
}: {
  label: string;
  count?: number | null;
  action?: ReactNode;
}) {
  return (
    <div className="sect">
      <div className="sect__title">
        <span className="eyebrow">{label}</span>
        {count != null && <span className="sect__count">{count}</span>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__glyph">{icon}</div>
      <p className="empty__title">{title}</p>
      {hint && <p className="empty__hint">{hint}</p>}
      {action}
    </div>
  );
}

export function SkeletonRows({ rows = 4, tall = false }: { rows?: number; tall?: boolean }) {
  return (
    <div className="skeletons" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div className={tall ? 'skeleton skeleton--tall' : 'skeleton'} key={index} />
      ))}
    </div>
  );
}

export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="inline-error" role="alert">
      <IconAlert className="inline-error__icon" />
      <div className="inline-error__body">
        <p>{message}</p>
        <span>Service unreachable — map and layout stay available.</span>
      </div>
      {onRetry && (
        <button type="button" className="btn btn--tiny" onClick={onRetry}>
          <IconRefresh />
          Retry
        </button>
      )}
    </div>
  );
}

const CONNECTION_COPY: Record<Connection, { label: string; hint: string }> = {
  live: { label: 'Live feed', hint: 'Streaming positions' },
  connecting: { label: 'Connecting', hint: 'Opening live feed' },
  reconnecting: { label: 'Reconnecting', hint: 'Polling fallback' },
  offline: { label: 'Offline', hint: 'No telemetry' },
};

export function ConnectionBadge({ connection, compact = false }: { connection: Connection; compact?: boolean }) {
  const copy = CONNECTION_COPY[connection];
  return (
    <div className="conn" data-conn={connection} role="status" aria-live="polite" title={copy.hint}>
      <span className="conn__dot" aria-hidden="true" />
      <span className="conn__label">{copy.label}</span>
      {!compact && <span className="conn__hint">{copy.hint}</span>}
    </div>
  );
}

const TOAST_ICON: Record<ToastTone, ReactNode> = {
  success: <IconCheck />,
  error: <IconAlert />,
  info: <IconInfo />,
};

export function Toasts({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {items.map((toast) => (
        <div className="toast" data-tone={toast.tone} key={toast.id} role="status">
          <span className="toast__icon">{TOAST_ICON[toast.tone]}</span>
          <p className="toast__message">{toast.message}</p>
          <button
            type="button"
            className="toast__close"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss notification"
          >
            <IconClose />
          </button>
        </div>
      ))}
    </div>
  );
}

export function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label className="field__label" htmlFor={htmlFor}>
      {children}
    </label>
  );
}

export function Clock({ className = '' }: { className?: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <time className={`clock ${className}`} dateTime={now.toISOString()}>
      {now.toLocaleTimeString('en-GB', { hour12: false })}
    </time>
  );
}
