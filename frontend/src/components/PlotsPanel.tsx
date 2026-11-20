import type { Location } from '../types';
import { fmtArea } from '../format';
import { EmptyState, InlineError, SectionHead, SkeletonRows } from './ui';
import { IconPlot, IconPlus } from './Icons';

interface PlotsPanelProps {
  locations: Location[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
  onCreate: () => void;
}

export function PlotsPanel({
  locations,
  loading,
  error,
  selectedId,
  onSelect,
  onRetry,
  onCreate,
}: PlotsPanelProps) {
  return (
    <section className="plots" aria-label="Spray plots">
      <SectionHead
        label="Plots"
        count={locations.length}
        action={
          <button type="button" className="btn btn--tiny btn--accent" onClick={onCreate}>
            <IconPlus />
            New
          </button>
        }
      />

      {loading && locations.length === 0 ? (
        <SkeletonRows rows={3} />
      ) : error && locations.length === 0 ? (
        <InlineError message={error} onRetry={onRetry} />
      ) : locations.length === 0 ? (
        <EmptyState
          icon={<IconPlot />}
          title="No plots mapped"
          hint="Drop the first field on the map to start scheduling."
          action={
            <button type="button" className="btn btn--tiny" onClick={onCreate}>
              <IconPlus />
              Add plot
            </button>
          }
        />
      ) : (
        <ul className="plots__list">
          {locations.map((location) => {
            const selected = location.id === selectedId;
            return (
              <li key={location.id}>
                <button
                  type="button"
                  className="plot-row"
                  data-selected={selected || undefined}
                  aria-pressed={selected}
                  onClick={() => onSelect(location.id)}
                >
                  <span className="plot-row__glyph">
                    <IconPlot />
                  </span>
                  <span className="plot-row__body">
                    <span className="plot-row__name">{location.name}</span>
                    <span className="plot-row__meta">
                      {[location.crop ?? 'unspecified crop', location.agent ?? 'no agent'].join(' · ')}
                    </span>
                  </span>
                  <span className="plot-row__area">{fmtArea(location.areaHectares)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
