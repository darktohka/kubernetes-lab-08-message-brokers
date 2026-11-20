import type { Mission, ScheduleRequest } from '../types';
import { fmtRelative, fmtTime, fmtWindow } from '../format';
import {
  EmptyState,
  InlineError,
  MissionStatusPill,
  ProgressBar,
  RequestStatusPill,
  SectionHead,
  SkeletonRows,
} from './ui';
import { IconCheck, IconClose, IconDrone, IconTarget } from './Icons';

interface QueuePanelProps {
  requests: ScheduleRequest[];
  missions: Mission[];
  loading: boolean;
  error: string | null;
  cancellingId: string | null;
  onRetry: () => void;
  onCancel: (id: string) => void;
  onFocusMission: (mission: Mission) => void;
}

export function QueuePanel({
  requests,
  missions,
  loading,
  error,
  cancellingId,
  onRetry,
  onCancel,
  onFocusMission,
}: QueuePanelProps) {
  const queued = requests.filter((request) => request.status === 'queued' || request.status === 'assigned');
  const active = missions.filter((mission) => mission.status !== 'done');
  const airborne = missions.filter((mission) => mission.status !== 'done').length;

  const isLoading = loading && requests.length === 0 && missions.length === 0;

  return (
    <section className="queue" aria-label="Live dispatch queue">
      <div className="queue__scroll">
        <SectionHead label="Queue" count={queued.length} />

        {isLoading ? (
          <SkeletonRows rows={3} tall />
        ) : error && requests.length === 0 ? (
          <InlineError message={error} onRetry={onRetry} />
        ) : queued.length === 0 ? (
          <EmptyState
            icon={<IconCheck />}
            title="Queue is clear"
            hint="New spray requests land here until a drone is free."
          />
        ) : (
          <ul className="queue__list">
            {queued.map((request) => (
              <li className="req" key={request.id} data-status={request.status}>
                <div className="req__head">
                  <span className="req__plot">{request.locationName}</span>
                  <RequestStatusPill status={request.status} />
                </div>
                <div className="req__meta">
                  <span>
                    {request.droneCount} drone{request.droneCount === 1 ? '' : 's'}
                  </span>
                  <span className="req__sep">·</span>
                  <span>{request.agent ?? 'agent n/a'}</span>
                  <span className="req__sep">·</span>
                  <span className="mono">{fmtWindow(request.startsAt, request.endsAt)}</span>
                </div>
                <div className="req__foot">
                  <span className="req__time">
                    {request.status === 'queued' ? `Window opens ${fmtRelative(request.startsAt)}` : 'Assigned to drones'}
                  </span>
                  <button
                    type="button"
                    className="btn btn--tiny btn--danger-ghost"
                    onClick={() => onCancel(request.id)}
                    disabled={cancellingId === request.id}
                    aria-label={`Cancel request for ${request.locationName}`}
                  >
                    <IconClose />
                    {cancellingId === request.id ? 'Cancelling…' : 'Cancel'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {!(error && missions.length === 0) && (
          <SectionHead label="Missions" count={airborne} action={<span className="sect__meta">in flight</span>} />
        )}

        {error && missions.length === 0 ? null : isLoading ? (
          <SkeletonRows rows={2} tall />
        ) : active.length === 0 ? (
          <EmptyState
            icon={<IconDrone />}
            title="No missions in flight"
            hint="Assigned missions appear here with live progress."
          />
        ) : (
          <ul className="queue__list">
            {active.map((mission) => (
              <li className="mission" key={mission.id} data-status={mission.status}>
                <div className="mission__head">
                  <span className="mission__drone">
                    <IconDrone />
                    {mission.droneName}
                  </span>
                  <MissionStatusPill status={mission.status} />
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => onFocusMission(mission)}
                    title={`Fly to ${mission.droneName}`}
                    aria-label={`Fly to ${mission.droneName} above ${mission.locationName}`}
                  >
                    <IconTarget />
                  </button>
                </div>
                <div className="mission__plot">
                  <span>{mission.locationName}</span>
                  {mission.agent && <span className="mission__agent">{mission.agent}</span>}
                  <span className="mono mission__battery">
                    {mission.battery != null ? `${Math.round(mission.battery)}%` : fmtTime(mission.startedAt)}
                  </span>
                </div>
                <ProgressBar value={mission.progress} status={mission.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
