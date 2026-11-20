import type { Drone } from '../types';
import { BatteryMeter, DroneStatusPill, EmptyState, InlineError, SectionHead, SkeletonRows } from './ui';
import { IconDrone } from './Icons';

interface FleetPanelProps {
  drones: Drone[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
}

export function FleetPanel({ drones, loading, error, selectedId, onSelect, onRetry }: FleetPanelProps) {
  const idle = drones.filter((drone) => drone.status === 'idle').length;
  const busy = drones.length - idle;

  return (
    <section className="fleet" aria-label="Drone fleet">
      <SectionHead
        label="Fleet"
        count={drones.length}
        action={
          drones.length > 0 ? (
            <span className="sect__meta">
              <span className="sect__meta-strong">{idle}</span> idle · {busy} active
            </span>
          ) : null
        }
      />

      {loading && drones.length === 0 ? (
        <SkeletonRows rows={4} tall />
      ) : error && drones.length === 0 ? (
        <InlineError message={error} onRetry={onRetry} />
      ) : drones.length === 0 ? (
        <EmptyState icon={<IconDrone />} title="No drones online" hint="The fleet service has not reported any aircraft yet." />
      ) : (
        <ul className="fleet__list">
          {drones.map((drone) => {
            const selected = drone.id === selectedId;
            const note = [drone.agent ?? 'No agent', drone.assignedLocationName ?? 'at base'].join(' · ');
            return (
              <li key={drone.id}>
                <button
                  type="button"
                  className="fleet-row"
                  data-status={drone.status}
                  data-selected={selected || undefined}
                  aria-pressed={selected}
                  onClick={() => onSelect(drone.id)}
                  title={`${drone.name} · ${drone.model}`}
                >
                  <span className="fleet-row__avatar">
                    <IconDrone />
                  </span>
                  <span className="fleet-row__body">
                    <span className="fleet-row__head">
                      <span className="fleet-row__name">{drone.name}</span>
                      <BatteryMeter level={drone.battery} />
                    </span>
                    <span className="fleet-row__foot">
                      <DroneStatusPill status={drone.status} />
                      <span className="fleet-row__note">{note}</span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
