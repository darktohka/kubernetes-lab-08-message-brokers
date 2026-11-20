import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { BASE, CITY_LABEL } from './constants';
import { fmtCoord } from './format';
import type {
  Drone,
  FlyTarget,
  Location as Plot,
  LocationDraft,
  LocationInput,
  Mission,
  ScheduleInput,
  ScheduleRequest,
  ToastItem,
  ToastTone,
} from './types';
import { useLiveStream, useMediaQuery } from './lib/useLiveStream';
import { MapView } from './components/MapView';
import { Brand } from './components/Brand';
import { FleetPanel } from './components/FleetPanel';
import { PlotsPanel } from './components/PlotsPanel';
import { SchedulePanel } from './components/SchedulePanel';
import { QueuePanel } from './components/QueuePanel';
import { LocationCard } from './components/LocationCard';
import { LocationForm } from './components/LocationForm';
import { Clock, ConnectionBadge, Toasts } from './components/ui';
import { IconDrone, IconPlot, IconPlus, IconRadius, IconTarget } from './components/Icons';

type SheetTab = 'fleet' | 'plots' | 'dispatch';

const EMPTY_FIELDS = { name: '', areaHectares: '10', crop: '', agent: '', ownerName: '' };

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Request failed';
}

export default function App() {
  const isMobile = useMediaQuery('(max-width: 1024px)');

  const [locations, setLocations] = useState<Plot[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [locationsError, setLocationsError] = useState<string | null>(null);

  const [drones, setDrones] = useState<Drone[]>([]);
  const [dronesLoading, setDronesLoading] = useState(true);
  const [dronesError, setDronesError] = useState<string | null>(null);

  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [selectedDroneId, setSelectedDroneId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LocationDraft | null>(null);
  const [flyTo, setFlyTo] = useState<FlyTarget | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [scheduleFlash, setScheduleFlash] = useState(0);
  const [sheetTab, setSheetTab] = useState<SheetTab>('fleet');
  const [sheetCollapsed, setSheetCollapsed] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toastSeq = useRef(0);
  const toastTimes = useRef(new Map<string, number>());

  const notify = useCallback((tone: ToastTone, message: string) => {
    const key = `${tone}:${message}`;
    const now = Date.now();
    if (now - (toastTimes.current.get(key) ?? 0) < 6000) return;
    toastTimes.current.set(key, now);
    const id = ++toastSeq.current;
    setToasts((previous) => [...previous.slice(-3), { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((previous) => previous.filter((toast) => toast.id !== id));
    }, 6500);
  }, []);

  const { positions, snapshot, snapshotError, connection, refreshSnapshot } = useLiveStream();

  const requests = useMemo<ScheduleRequest[]>(() => snapshot?.requests ?? [], [snapshot]);
  const missions = useMemo<Mission[]>(() => snapshot?.missions ?? [], [snapshot]);
  const queueLoading = snapshot === null && snapshotError === null;
  const queueError = snapshot ? null : snapshotError;

  // Live positions override the persisted fleet snapshot, so markers and list agree.
  const fleet = useMemo<Drone[]>(() => {
    if (positions.size === 0) return drones;
    return drones.map((drone) => {
      const live = positions.get(drone.id);
      if (!live) return drone;
      return { ...drone, lat: live.lat, lng: live.lng, battery: live.battery, status: live.status };
    });
  }, [drones, positions]);

  const loadLocations = useCallback(
    async (initial = false) => {
      try {
        const list = await api.getLocations();
        setLocations(list);
        setLocationsError(null);
      } catch (error) {
        const message = errorText(error);
        setLocationsError(message);
        if (initial) notify('error', `Plots unavailable: ${message}.`);
      } finally {
        setLocationsLoading(false);
      }
    },
    [notify],
  );

  useEffect(() => {
    void loadLocations(true);
  }, [loadLocations]);

  // Fleet metadata refresh; speeds up to a 3 s poll whenever the stream is not live.
  useEffect(() => {
    let alive = true;
    let first = true;

    const load = async () => {
      try {
        const list = await api.getDrones();
        if (!alive) return;
        setDrones(list);
        setDronesError(null);
      } catch (error) {
        if (!alive) return;
        setDronesError(errorText(error));
        if (first) notify('error', `Fleet unavailable: ${errorText(error)}.`);
      } finally {
        if (alive) {
          setDronesLoading(false);
          first = false;
        }
      }
    };

    void load();
    const interval = window.setInterval(load, connection === 'live' ? 10000 : 3000);
    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [connection, notify]);

  useEffect(() => {
    if (!isMobile) return;
    if (selectedLocationId) {
      setSheetTab('plots');
      setSheetCollapsed(false);
    }
  }, [isMobile, selectedLocationId]);

  const selectedLocation = useMemo(
    () => locations.find((location) => location.id === selectedLocationId) ?? null,
    [locations, selectedLocationId],
  );

  const selectedLocationMissions = useMemo(
    () =>
      selectedLocationId
        ? missions.filter((mission) => mission.locationId === selectedLocationId && mission.status !== 'done').length
        : 0,
    [missions, selectedLocationId],
  );

  const flyToCoords = useCallback((lat: number, lng: number, zoom: number) => {
    setFlyTo({ lat, lng, zoom, nonce: Date.now() });
  }, []);

  const selectLocation = useCallback(
    (id: string) => {
      setSelectedLocationId(id);
      const location = locations.find((item) => item.id === id);
      if (location) flyToCoords(location.lat, location.lng, 13);
    },
    [locations, flyToCoords],
  );

  const selectLocationFromMap = useCallback((id: string) => {
    setSelectedLocationId(id);
  }, []);

  const selectDrone = useCallback(
    (id: string) => {
      setSelectedDroneId(id);
      const drone = fleet.find((item) => item.id === id);
      if (drone) flyToCoords(drone.lat, drone.lng, 14);
      if (isMobile) {
        setSheetTab('fleet');
        setSheetCollapsed(false);
      }
    },
    [fleet, flyToCoords, isMobile],
  );

  const startCreate = useCallback(() => {
    setSelectedLocationId(null);
    setDraft({ mode: 'create', lat: null, lng: null, formOpen: false, fields: { ...EMPTY_FIELDS } });
    if (isMobile) setSheetCollapsed(true);
  }, [isMobile]);

  const startEdit = useCallback(() => {
    if (!selectedLocation) return;
    setDraft({
      mode: 'edit',
      id: selectedLocation.id,
      lat: selectedLocation.lat,
      lng: selectedLocation.lng,
      formOpen: true,
      fields: {
        name: selectedLocation.name,
        areaHectares: String(selectedLocation.areaHectares),
        crop: selectedLocation.crop ?? '',
        agent: selectedLocation.agent ?? '',
        ownerName: selectedLocation.ownerName ?? '',
      },
    });
    if (isMobile) setSheetCollapsed(true);
  }, [selectedLocation, isMobile]);

  const cancelDraft = useCallback(() => setDraft(null), []);

  useEffect(() => {
    if (!draft) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setDraft(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [draft]);

  const handleMapClick = useCallback((lat: number, lng: number) => {
    setDraft((current) => (current ? { ...current, lat, lng, formOpen: true } : current));
  }, []);

  const handleCoords = useCallback((lat: number, lng: number) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            lat: Number.isFinite(lat) ? lat : current.lat,
            lng: Number.isFinite(lng) ? lng : current.lng,
          }
        : current,
    );
  }, []);

  const saveDraft = useCallback(
    async (input: LocationInput) => {
      if (!draft) return;
      try {
        if (draft.mode === 'create') {
          const created = await api.createLocation(input);
          setLocations((previous) => [...previous, created]);
          setSelectedLocationId(created.id);
          setDraft(null);
          flyToCoords(created.lat, created.lng, 14);
          notify('success', `${created.name} added to the map.`);
        } else if (draft.id) {
          const updated = await api.updateLocation(draft.id, input);
          setLocations((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
          setSelectedLocationId(updated.id);
          setDraft(null);
          notify('success', `${updated.name} updated.`);
        }
      } catch (error) {
        notify('error', `Could not save plot — ${errorText(error)}.`);
        throw error;
      }
    },
    [draft, flyToCoords, notify],
  );

  const deleteSelectedLocation = useCallback(async (): Promise<boolean> => {
    if (!selectedLocation) return false;
    try {
      await api.deleteLocation(selectedLocation.id);
      setLocations((previous) => previous.filter((item) => item.id !== selectedLocation.id));
      setSelectedLocationId(null);
      notify('success', `${selectedLocation.name} deleted.`);
      return true;
    } catch (error) {
      notify('error', `Delete failed — ${errorText(error)}.`);
      return false;
    }
  }, [selectedLocation, notify]);

  const submitSchedule = useCallback(
    async (input: ScheduleInput): Promise<boolean> => {
      setSubmitting(true);
      try {
        const created = await api.createRequest(input);
        notify('success', `Request queued for ${created.locationName}.`);
        await refreshSnapshot();
        return true;
      } catch (error) {
        notify('error', `Scheduling failed — ${errorText(error)}.`);
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [notify, refreshSnapshot],
  );

  const cancelRequest = useCallback(
    async (id: string) => {
      setCancellingId(id);
      try {
        await api.cancelRequest(id);
        notify('info', 'Request cancelled.');
        await refreshSnapshot();
      } catch (error) {
        notify('error', `Could not cancel request — ${errorText(error)}.`);
      } finally {
        setCancellingId(null);
      }
    },
    [notify, refreshSnapshot],
  );

  const focusMission = useCallback(
    (mission: Mission) => {
      const drone = fleet.find((item) => item.id === mission.droneId);
      const lat = drone?.lat ?? mission.latNow ?? mission.lat;
      const lng = drone?.lng ?? mission.lngNow ?? mission.lng;
      setSelectedDroneId(mission.droneId);
      setFlyTo({ lat, lng, zoom: 14, nonce: Date.now() });
      if (isMobile) {
        setSheetTab('fleet');
        setSheetCollapsed(false);
      }
    },
    [fleet, isMobile],
  );

  const scheduleFromPlot = useCallback(() => {
    if (!selectedLocation) return;
    setScheduleFlash((value) => value + 1);
    if (isMobile) {
      setSheetTab('dispatch');
      setSheetCollapsed(false);
    }
  }, [selectedLocation, isMobile]);

  const recenter = useCallback(() => {
    setFlyTo({ lat: BASE.lat, lng: BASE.lng, zoom: 12, nonce: Date.now() });
  }, []);

  const fitRadius = useCallback(() => {
    setFlyTo({ lat: BASE.lat, lng: BASE.lng, zoom: 11, nonce: Date.now() });
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  }, []);

  const placing = draft !== null;
  const placingCopy = !draft
    ? ''
    : draft.mode === 'edit'
      ? 'Click the map to move the plot pin'
      : draft.formOpen
        ? 'Click the map to adjust the new pin'
        : 'Click the map to place the plot';

  const showForm = draft?.formOpen === true;

  const fleetPanel = (
    <FleetPanel
      drones={fleet}
      loading={dronesLoading}
      error={dronesError}
      selectedId={selectedDroneId}
      onSelect={selectDrone}
      onRetry={() => {
        setDronesLoading(true);
        void api
          .getDrones()
          .then((list) => {
            setDrones(list);
            setDronesError(null);
          })
          .catch((error: unknown) => setDronesError(errorText(error)))
          .finally(() => setDronesLoading(false));
      }}
    />
  );

  const plotsPanel = (
    <PlotsPanel
      locations={locations}
      loading={locationsLoading}
      error={locationsError}
      selectedId={selectedLocationId}
      onSelect={selectLocation}
      onRetry={() => {
        setLocationsLoading(true);
        void loadLocations(false);
      }}
      onCreate={startCreate}
    />
  );

  const schedulePanel = (
    <SchedulePanel
      locations={locations}
      locationsError={locationsError}
      selectedLocationId={selectedLocationId}
      submitting={submitting}
      flashNonce={scheduleFlash}
      onSubmit={submitSchedule}
    />
  );

  const queuePanel = (
    <QueuePanel
      requests={requests}
      missions={missions}
      loading={queueLoading}
      error={queueError}
      cancellingId={cancellingId}
      onRetry={() => {
        void refreshSnapshot();
      }}
      onCancel={cancelRequest}
      onFocusMission={focusMission}
    />
  );

  const sheetCounts: Record<SheetTab, number> = {
    fleet: fleet.length,
    plots: locations.length,
    dispatch:
      requests.filter((request) => request.status === 'queued' || request.status === 'assigned').length +
      missions.filter((mission) => mission.status !== 'done').length,
  };

  return (
    <div className="app" data-sheet={sheetCollapsed ? 'collapsed' : 'expanded'}>
      <MapView
        locations={locations}
        drones={fleet}
        selectedLocationId={selectedLocationId}
        selectedDroneId={selectedDroneId}
        placing={placing}
        draft={draft && draft.lat != null && draft.lng != null ? { lat: draft.lat, lng: draft.lng } : null}
        flyTo={flyTo}
        onMapClick={handleMapClick}
        onSelectLocation={selectLocationFromMap}
        onSelectDrone={selectDrone}
      />

      <div className="grain" aria-hidden="true" />

      {!isMobile && (
        <>
          <aside className="rail rail--left">
            <div className="brand-block">
              <Brand />
              <p className="brand-block__tagline">Drone spraying operations · {CITY_LABEL}</p>
              <div className="brand-block__meta mono">
                <span>BASE {fmtCoord(BASE.lat, BASE.lng)}</span>
                <span className="brand-block__radius">R 15 km</span>
              </div>
            </div>
            <div className="rail__scroll">
              {fleetPanel}
              {plotsPanel}
            </div>
            <div className="rail-foot">
              <IconTarget />
              <span>Operations radius 15 km</span>
              <span className="rail-foot__pending">{locations.length === 0 ? 'no plots' : 'auto-dispatch on'}</span>
            </div>
          </aside>

          <aside className="rail rail--right">
            {schedulePanel}
            {queuePanel}
          </aside>
        </>
      )}

      {!isMobile && !draft && (
        <div className="hud">
          <ConnectionBadge connection={connection} />
          <span className="hud__rule" />
          <Clock className="hud__clock" />
          <span className="hud__rule" />
          <span className="hud__stat">
            <b>{fleet.length}</b> aircraft
          </span>
          <span className="hud__stat">
            <b>{locations.length}</b> plots
          </span>
          <button
            type="button"
            className="icon-btn hud__btn"
            onClick={fitRadius}
            aria-label="Show the 15 kilometre operating radius"
            title="Show operating radius"
          >
            <IconRadius />
          </button>
          <button
            type="button"
            className="icon-btn hud__btn"
            onClick={recenter}
            aria-label="Recenter map on base"
            title="Recenter on base"
          >
            <IconTarget />
          </button>
        </div>
      )}

      {isMobile && (
        <>
          <header className="mobile-bar">
            <Brand compact />
            <div className="mobile-bar__right">
              <ConnectionBadge connection={connection} compact />
              <button type="button" className="icon-btn" onClick={startCreate} aria-label="New plot">
                <IconPlus />
              </button>
            </div>
          </header>

          <section className="sheet" aria-label="Operations panels">
            <button
              type="button"
              className="sheet__grip"
              onClick={() => setSheetCollapsed((value) => !value)}
              aria-expanded={!sheetCollapsed}
              aria-label={sheetCollapsed ? 'Expand operations panel' : 'Collapse operations panel'}
            >
              <span className="sheet__grip-line" />
            </button>

            <div className="sheet__tabs" role="tablist" aria-label="Operations panels">
              {(
                [
                  ['fleet', 'Fleet', <IconDrone key="d" />],
                  ['plots', 'Plots', <IconPlot key="p" />],
                  ['dispatch', 'Dispatch', <IconTarget key="t" />],
                ] as const
              ).map(([id, label, icon]) => (
                <button
                  type="button"
                  role="tab"
                  key={id}
                  aria-selected={sheetTab === id}
                  aria-controls="sheet-panel"
                  id={`sheet-tab-${id}`}
                  onClick={() => {
                    setSheetTab(id);
                    setSheetCollapsed(false);
                  }}
                >
                  {icon}
                  {label}
                  <span className="sheet__count">{sheetCounts[id]}</span>
                </button>
              ))}
            </div>

            <div
              className="sheet__body"
              id="sheet-panel"
              role="tabpanel"
              aria-labelledby={`sheet-tab-${sheetTab}`}
              hidden={sheetCollapsed}
            >
              {sheetTab === 'fleet' && fleetPanel}
              {sheetTab === 'plots' && (
                <div className="sheet__stack">
                  {selectedLocation && !draft && (
                    <LocationCard
                      location={selectedLocation}
                      missionCount={selectedLocationMissions}
                      onClose={() => setSelectedLocationId(null)}
                      onEdit={startEdit}
                      onDelete={deleteSelectedLocation}
                      onSchedule={scheduleFromPlot}
                    />
                  )}
                  {plotsPanel}
                </div>
              )}
              {sheetTab === 'dispatch' && (
                <div className="sheet__stack">
                  {schedulePanel}
                  {queuePanel}
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {draft && (
        <div className="placing-bar" role="status">
          <span className="placing-bar__icon">
            <IconTarget />
          </span>
          <span className="placing-bar__text">{placingCopy}</span>
          <button type="button" className="btn btn--tiny" onClick={cancelDraft}>
            Cancel <kbd>Esc</kbd>
          </button>
        </div>
      )}

      {!isMobile && selectedLocation && !draft && (
        <LocationCard
          location={selectedLocation}
          missionCount={selectedLocationMissions}
          onClose={() => setSelectedLocationId(null)}
          onEdit={startEdit}
          onDelete={deleteSelectedLocation}
          onSchedule={scheduleFromPlot}
        />
      )}

      {showForm && draft && (
        <LocationForm
          mode={draft.mode}
          lat={draft.lat}
          lng={draft.lng}
          fields={draft.fields}
          onCoords={handleCoords}
          onSave={saveDraft}
          onCancel={cancelDraft}
        />
      )}

      {!isMobile && !draft && locations.length === 0 && !locationsLoading && !locationsError && (
        <div className="map-hint">
          <IconPlot />
          <span>No plots mapped yet</span>
          <button type="button" className="btn btn--tiny" onClick={startCreate}>
            <IconPlus />
            Place the first plot
          </button>
        </div>
      )}

      <Toasts items={toasts} onDismiss={dismissToast} />
    </div>
  );
}
