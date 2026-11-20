import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Connection, LivePosition, SchedulingState } from '../types';
import { toDroneStatus } from '../types';

const STREAM_SILENCE_MS = 7000;
const POLL_INTERVAL_MS = 4000;
const POLL_ERROR_INTERVAL_MS = 6000;

export interface LiveStreamResult {
  positions: Map<string, LivePosition>;
  snapshot: SchedulingState | null;
  snapshotError: string | null;
  connection: Connection;
  refreshSnapshot: () => Promise<boolean>;
}

/**
 * Subscribes to the scheduling SSE stream (positions + state) and transparently
 * falls back to polling GET /api/scheduling/state when the stream is unavailable.
 */
export function useLiveStream(): LiveStreamResult {
  const [positions, setPositions] = useState<Map<string, LivePosition>>(() => new Map());
  const [snapshot, setSnapshot] = useState<SchedulingState | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [tick, setTick] = useState(0);

  const lastEventAt = useRef(0);
  const lastPollOkAt = useRef(0);
  const mountedAt = useRef(Date.now());

  useEffect(() => {
    let source: EventSource | null = null;

    const markLive = () => {
      lastEventAt.current = Date.now();
      setConnection((current) => (current === 'live' ? current : 'live'));
    };

    try {
      source = new EventSource('/api/scheduling/stream');
    } catch {
      source = null;
    }

    if (source) {
      source.addEventListener('open', () => {
        lastEventAt.current = Date.now();
        setConnection('live');
      });

      source.addEventListener('state', (event) => {
        markLive();
        try {
          const parsed = JSON.parse((event as MessageEvent<string>).data) as Record<string, unknown>;
          setSnapshot(api.shapeState(parsed));
          setSnapshotError(null);
        } catch {
          /* ignore malformed frame */
        }
      });

      source.addEventListener('positions', (event) => {
        markLive();
        try {
          const parsed = JSON.parse((event as MessageEvent<string>).data) as { positions?: unknown[] };
          const incoming = parsed.positions;
          if (!Array.isArray(incoming)) return;
          setPositions((previous) => {
            const next = new Map(previous);
            for (const raw of incoming) {
              const item = raw as Record<string, unknown> | null;
              if (!item || typeof item.droneId !== 'string') continue;
              const lat = Number(item.lat);
              const lng = Number(item.lng);
              if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
              const battery = Number(item.battery);
              const progress = Number(item.progress);
              next.set(item.droneId, {
                droneId: item.droneId,
                missionId: typeof item.missionId === 'string' ? item.missionId : null,
                lat,
                lng,
                battery: Number.isFinite(battery) ? Math.round(battery) : 0,
                status: toDroneStatus(item.status),
                progress: Number.isFinite(progress) ? progress : undefined,
                ts: Number.isFinite(Number(item.ts)) ? Number(item.ts) : Date.now() / 1000,
              });
            }
            return next;
          });
        } catch {
          /* ignore malformed frame */
        }
      });

      source.onerror = () => {
        setConnection((current) => (current === 'live' ? 'reconnecting' : current));
      };
    }

    const clock = window.setInterval(() => setTick((value) => value + 1), 2000);
    return () => {
      window.clearInterval(clock);
      source?.close();
    };
  }, []);

  // Derive a truthful connection state from frame recency rather than trusting
  // the EventSource lifecycle, which happily stays "open" on a dead proxy.
  useEffect(() => {
    const now = Date.now();
    const streamAge = lastEventAt.current === 0 ? Number.POSITIVE_INFINITY : now - lastEventAt.current;
    const pollFresh = lastPollOkAt.current > 0 && now - lastPollOkAt.current < 12000;
    const warmingUp = now - mountedAt.current < 4500;

    if (streamAge < STREAM_SILENCE_MS) {
      setConnection((current) => (current === 'live' ? current : 'live'));
    } else if (warmingUp) {
      setConnection((current) => (current === 'offline' ? current : current === 'live' ? 'reconnecting' : 'connecting'));
    } else if (pollFresh) {
      setConnection((current) => (current === 'reconnecting' ? current : 'reconnecting'));
    } else {
      setConnection((current) => (current === 'offline' ? current : 'offline'));
    }
  }, [tick]);

  const refreshSnapshot = useCallback(async (): Promise<boolean> => {
    try {
      const state = await api.getState();
      lastPollOkAt.current = Date.now();
      setSnapshot(state);
      setSnapshotError(null);
      return true;
    } catch (error) {
      setSnapshotError(error instanceof Error ? error.message : 'Scheduling service unavailable');
      return false;
    }
  }, []);

  // Polling fallback, only while the stream is not proven live.
  const streamLive = connection === 'live';
  useEffect(() => {
    if (streamLive) return;
    let cancelled = false;
    let handle = 0;
    let attempt = 0;
    let failing = false;

    const run = async () => {
      try {
        const state = await api.getState();
        if (cancelled) return;
        failing = false;
        lastPollOkAt.current = Date.now();
        setSnapshot(state);
        setSnapshotError(null);
      } catch (error) {
        if (cancelled) return;
        failing = true;
        setSnapshotError(error instanceof Error ? error.message : 'Scheduling service unavailable');
      } finally {
        if (!cancelled) {
          attempt += 1;
          handle = window.setTimeout(
            run,
            attempt < 3 ? 1500 : failing ? POLL_ERROR_INTERVAL_MS : POLL_INTERVAL_MS,
          );
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamLive]);

  return { positions, snapshot, snapshotError, connection, refreshSnapshot };
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
