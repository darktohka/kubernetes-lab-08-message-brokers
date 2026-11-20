import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Location, ScheduleInput } from '../types';
import { AGENT_OPTIONS } from '../constants';
import { fmtArea, fromLocalInput, toLocalInput } from '../format';
import { SectionHead } from './ui';
import { IconArrowUpRight, IconChevron, IconClock, IconMinus, IconPlus } from './Icons';

interface SchedulePanelProps {
  locations: Location[];
  locationsError?: string | null;
  selectedLocationId: string | null;
  submitting: boolean;
  flashNonce: number;
  onSubmit: (input: ScheduleInput) => Promise<boolean>;
}

function freshWindow(): { start: string; end: string } {
  const now = new Date();
  return {
    start: toLocalInput(now),
    end: toLocalInput(new Date(now.getTime() + 30 * 60_000)),
  };
}

export function SchedulePanel({
  locations,
  locationsError,
  selectedLocationId,
  submitting,
  flashNonce,
  onSubmit,
}: SchedulePanelProps) {
  const initial = useMemo(freshWindow, []);
  const [locationId, setLocationId] = useState(selectedLocationId ?? '');
  const [count, setCount] = useState(1);
  const [agent, setAgent] = useState<string>(AGENT_OPTIONS[0]);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const countRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (selectedLocationId) setLocationId(selectedLocationId);
  }, [selectedLocationId]);

  useEffect(() => {
    if (!flashNonce) return;
    const form = formRef.current;
    if (form) {
      form.classList.add('is-flash');
      countRef.current?.focus();
      countRef.current?.select();
      const timer = window.setTimeout(() => form.classList.remove('is-flash'), 1400);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [flashNonce]);

  const selected = locations.find((location) => location.id === locationId) ?? null;

  const agents = useMemo(() => {
    const set = new Set<string>(AGENT_OPTIONS);
    for (const location of locations) if (location.agent) set.add(location.agent);
    return Array.from(set);
  }, [locations]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!locationId) {
      setError('Choose a plot to spray.');
      return;
    }
    const startsAt = fromLocalInput(start);
    const endsAt = fromLocalInput(end);
    if (!startsAt || !endsAt) {
      setError('Set both a start and an end time.');
      return;
    }
    if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      setError('End time must be after the start time.');
      return;
    }

    setError(null);
    const ok = await onSubmit({
      locationId,
      droneCount: count,
      agent: agent || null,
      startsAt,
      endsAt,
    });

    if (ok) {
      const next = freshWindow();
      setStart(next.start);
      setEnd(next.end);
    }
  };

  return (
    <section className="schedule" aria-label="Schedule drones">
      <SectionHead label="Schedule" action={<span className="sect__meta">new request</span>} />

      {locations.length === 0 && (
        <p className="form-note form-note--warn">
          <IconClock />
          {locationsError
            ? 'Plots unavailable — the location service is unreachable.'
            : 'No plots available — add a plot before scheduling.'}
        </p>
      )}

      <form className="form" onSubmit={handleSubmit} ref={formRef} noValidate>
        <div className="field">
          <label className="field__label" htmlFor="schedule-plot">
            Plot
          </label>
          <div className="select-wrap">
            <select
              id="schedule-plot"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
              disabled={locations.length === 0}
            >
              <option value="" disabled>
                Choose a plot
              </option>
              {locations.map((location) => (
                <option value={location.id} key={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
            <IconChevron className="select-wrap__chevron" />
          </div>
          <p className="field__hint">
            {selected
              ? `${fmtArea(selected.areaHectares)} · ${selected.crop ?? 'crop unspecified'}`
              : 'Select the field to be sprayed'}
          </p>
        </div>

        <div className="form__grid">
          <div className="field">
            <label className="field__label" htmlFor="schedule-count">
              Drones
            </label>
            <div className="stepper">
              <button
                type="button"
                className="stepper__btn"
                aria-label="One drone fewer"
                onClick={() => setCount((value) => Math.max(1, value - 1))}
                disabled={count <= 1}
              >
                <IconMinus />
              </button>
              <input
                id="schedule-count"
                ref={countRef}
                className="stepper__input"
                type="number"
                inputMode="numeric"
                min={1}
                max={12}
                value={count}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setCount(Number.isFinite(next) ? Math.min(12, Math.max(1, Math.round(next))) : 1);
                }}
              />
              <button
                type="button"
                className="stepper__btn"
                aria-label="One drone more"
                onClick={() => setCount((value) => Math.min(12, value + 1))}
                disabled={count >= 12}
              >
                <IconPlus />
              </button>
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="schedule-agent">
              Agent
            </label>
            <div className="select-wrap">
              <select id="schedule-agent" value={agent} onChange={(event) => setAgent(event.target.value)}>
                {agents.map((option) => (
                  <option value={option} key={option}>
                    {option}
                  </option>
                ))}
              </select>
              <IconChevron className="select-wrap__chevron" />
            </div>
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="schedule-start">
            Start
          </label>
          <input
            id="schedule-start"
            type="datetime-local"
            value={start}
            onChange={(event) => setStart(event.target.value)}
            step={300}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="schedule-end">
            End
          </label>
          <input
            id="schedule-end"
            type="datetime-local"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
            step={300}
          />
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          className="btn btn--primary btn--block"
          disabled={submitting || locations.length === 0}
        >
          {submitting ? 'Sending request…' : 'Request drones'}
          {!submitting && <IconArrowUpRight />}
        </button>

        <p className="form-note">Idle drones are assigned automatically by the dispatch service.</p>
      </form>
    </section>
  );
}
