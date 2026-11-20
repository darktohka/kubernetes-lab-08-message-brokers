import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { DraftFields, DraftMode, LocationInput } from '../types';
import { AGENT_OPTIONS, CROP_OPTIONS } from '../constants';
import { IconClose, IconTarget } from './Icons';

interface LocationFormProps {
  mode: DraftMode;
  lat: number | null;
  lng: number | null;
  fields: DraftFields;
  onCoords: (lat: number, lng: number) => void;
  onSave: (input: LocationInput) => Promise<void>;
  onCancel: () => void;
}

const COORD_PRECISION = 5;

export function LocationForm({ mode, lat, lng, fields, onCoords, onSave, onCancel }: LocationFormProps) {
  const [form, setForm] = useState<DraftFields>(fields);
  const [latText, setLatText] = useState(lat != null ? lat.toFixed(COORD_PRECISION) : '');
  const [lngText, setLngText] = useState(lng != null ? lng.toFixed(COORD_PRECISION) : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const latTextRef = useRef(latText);
  const lngTextRef = useRef(lngText);
  latTextRef.current = latText;
  lngTextRef.current = lngText;

  useEffect(() => {
    if (lat == null) return;
    if (Math.abs(Number(latTextRef.current) - lat) > 1e-9) setLatText(lat.toFixed(COORD_PRECISION));
  }, [lat]);

  useEffect(() => {
    if (lng == null) return;
    if (Math.abs(Number(lngTextRef.current) - lng) > 1e-9) setLngText(lng.toFixed(COORD_PRECISION));
  }, [lng]);

  const update = (key: keyof DraftFields) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const editCoords = (axis: 'lat' | 'lng', value: string) => {
    // Only move the draft pin once a complete pair is known, so typing a bare
    // latitude never teleports the map to the prime meridian.
    if (axis === 'lat') {
      setLatText(value);
      const parsed = Number(value);
      if (value.trim() !== '' && Number.isFinite(parsed) && lng != null) onCoords(parsed, lng);
    } else {
      setLngText(value);
      const parsed = Number(value);
      if (value.trim() !== '' && Number.isFinite(parsed) && lat != null) onCoords(lat, parsed);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setError('Give the plot a name.');
      nameRef.current?.focus();
      return;
    }

    const area = Number(form.areaHectares.replace(',', '.'));
    if (!Number.isFinite(area) || area < 0) {
      setError('Area must be a positive number of hectares.');
      return;
    }

    const latNumber = Number(latText);
    const lngNumber = Number(lngText);
    if (!Number.isFinite(latNumber) || Math.abs(latNumber) > 90) {
      setError('Latitude must be a number between -90 and 90.');
      return;
    }
    if (!Number.isFinite(lngNumber) || Math.abs(lngNumber) > 180) {
      setError('Longitude must be a number between -180 and 180.');
      return;
    }

    setError(null);
    setBusy(true);
    try {
      await onSave({
        name,
        lat: latNumber,
        lng: lngNumber,
        areaHectares: area,
        crop: form.crop.trim() || null,
        agent: form.agent.trim() || null,
        ownerName: form.ownerName.trim() || null,
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not save the plot.');
    } finally {
      setBusy(false);
    }
  };

  const hasCoords = Number.isFinite(Number(latText)) && latText !== '' && lngText !== '';

  return (
    <section className="loc-form" role="region" aria-label={mode === 'create' ? 'New plot' : 'Edit plot'}>
      <header className="loc-form__head">
        <span className="eyebrow">{mode === 'create' ? 'New plot' : 'Edit plot'}</span>
        <button type="button" className="icon-btn" onClick={onCancel} aria-label="Cancel and close">
          <IconClose />
        </button>
      </header>

      <p className="loc-form__hint">
        <IconTarget />
        {hasCoords ? 'Click the map to move the pin' : 'Click the map to place the plot'}
        <span className="loc-form__esc">Esc to cancel</span>
      </p>

      <form className="form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label className="field__label" htmlFor="plot-name">
            Plot name
          </label>
          <input
            id="plot-name"
            ref={nameRef}
            autoFocus
            value={form.name}
            onChange={(event) => update('name')(event.target.value)}
            placeholder="e.g. Luncani Wheat Field"
            autoComplete="off"
          />
        </div>

        <div className="form__grid">
          <div className="field">
            <label className="field__label" htmlFor="plot-area">
              Area (ha)
            </label>
            <input
              id="plot-area"
              inputMode="decimal"
              value={form.areaHectares}
              onChange={(event) => update('areaHectares')(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="plot-crop">
              Crop
            </label>
            <input
              id="plot-crop"
              list="crop-options"
              value={form.crop}
              onChange={(event) => update('crop')(event.target.value)}
              placeholder="Wheat"
              autoComplete="off"
            />
            <datalist id="crop-options">
              {CROP_OPTIONS.map((option) => (
                <option value={option} key={option} />
              ))}
            </datalist>
          </div>
        </div>

        <div className="form__grid">
          <div className="field">
            <label className="field__label" htmlFor="plot-agent">
              Agent
            </label>
            <input
              id="plot-agent"
              list="agent-options"
              value={form.agent}
              onChange={(event) => update('agent')(event.target.value)}
              placeholder="Herbicide"
              autoComplete="off"
            />
            <datalist id="agent-options">
              {AGENT_OPTIONS.map((option) => (
                <option value={option} key={option} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="plot-owner">
              Owner
            </label>
            <input
              id="plot-owner"
              value={form.ownerName}
              onChange={(event) => update('ownerName')(event.target.value)}
              placeholder="Farm or contact"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="form__grid">
          <div className="field">
            <label className="field__label" htmlFor="plot-lat">
              Latitude
            </label>
            <input
              id="plot-lat"
              className="mono"
              inputMode="decimal"
              value={latText}
              onChange={(event) => editCoords('lat', event.target.value)}
              placeholder="46.5386"
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="plot-lng">
              Longitude
            </label>
            <input
              id="plot-lng"
              className="mono"
              inputMode="decimal"
              value={lngText}
              onChange={(event) => editCoords('lng', event.target.value)}
              placeholder="24.5578"
            />
          </div>
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="form__actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? 'Saving…' : mode === 'create' ? 'Save plot' : 'Save changes'}
          </button>
        </div>
      </form>
    </section>
  );
}
