import { useState } from 'react';
import type { Location } from '../types';
import { fmtArea, fmtCoord } from '../format';
import { IconClose, IconPencil, IconTarget, IconTrash } from './Icons';

interface LocationCardProps {
  location: Location;
  missionCount: number;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => Promise<boolean>;
  onSchedule: () => void;
}

export function LocationCard({ location, missionCount, onClose, onEdit, onDelete, onSchedule }: LocationCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <section className="plot-card" aria-label={`Plot ${location.name}`}>
      <header className="plot-card__head">
        <span className="eyebrow">
          Plot · {fmtArea(location.areaHectares)}
          {missionCount > 0 && <span className="plot-card__live">{missionCount} active</span>}
        </span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close plot details">
          <IconClose />
        </button>
      </header>

      <h2 className="plot-card__name">{location.name}</h2>

      <dl className="kv">
        <div className="kv__item">
          <dt>Crop</dt>
          <dd>{location.crop ?? '—'}</dd>
        </div>
        <div className="kv__item">
          <dt>Agent</dt>
          <dd>{location.agent ?? '—'}</dd>
        </div>
        <div className="kv__item">
          <dt>Owner</dt>
          <dd>{location.ownerName ?? '—'}</dd>
        </div>
        <div className="kv__item">
          <dt>Area</dt>
          <dd>{fmtArea(location.areaHectares)}</dd>
        </div>
      </dl>

      <p className="plot-card__coord mono">
        <IconTarget />
        {fmtCoord(location.lat, location.lng, 5)}
      </p>

      {location.notes && <p className="plot-card__notes">{location.notes}</p>}

      {confirming ? (
        <div className="confirm" role="alertdialog" aria-label="Confirm deleting plot">
          <p>Delete “{location.name}”? This cannot be undone.</p>
          <div className="confirm__actions">
            <button type="button" className="btn btn--tiny" onClick={() => setConfirming(false)} disabled={deleting}>
              Keep plot
            </button>
            <button type="button" className="btn btn--tiny btn--danger" onClick={handleDelete} disabled={deleting}>
              <IconTrash />
              {deleting ? 'Deleting…' : 'Delete plot'}
            </button>
          </div>
        </div>
      ) : (
        <div className="plot-card__actions">
          <button type="button" className="btn btn--primary" onClick={onSchedule}>
            Schedule spray
          </button>
          <button type="button" className="btn" onClick={onEdit}>
            <IconPencil />
            Edit
          </button>
          <button type="button" className="btn btn--danger-ghost" onClick={() => setConfirming(true)}>
            <IconTrash />
            Delete
          </button>
        </div>
      )}
    </section>
  );
}
