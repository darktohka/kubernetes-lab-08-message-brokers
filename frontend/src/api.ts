import type {
  Drone,
  Location,
  LocationInput,
  Mission,
  ScheduleInput,
  ScheduleRequest,
  SchedulingState,
} from './types';
import { toDroneStatus, toMissionStatus, toRequestStatus } from './types';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : null),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'Network unreachable');
  }

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    if (isJson) {
      try {
        const body = (await response.json()) as { error?: unknown };
        if (body && typeof body.error === 'string' && body.error.trim()) message = body.error;
      } catch {
        /* malformed error body */
      }
    }
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) return undefined as T;

  // A 200 HTML page usually means the API route was swallowed by the SPA fallback.
  if (!isJson) {
    throw new ApiError(502, 'The service returned an unexpected response');
  }
  return (await response.json()) as T;
}

function num(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fallback;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function shapeDrone(raw: Record<string, unknown>): Drone {
  return {
    id: String(raw.id),
    name: typeof raw.name === 'string' ? raw.name : 'Drone',
    model: typeof raw.model === 'string' ? raw.model : '',
    status: toDroneStatus(raw.status),
    lat: num(raw.lat),
    lng: num(raw.lng),
    homeLat: num(raw.homeLat),
    homeLng: num(raw.homeLng),
    battery: Math.round(num(raw.battery, 100)),
    agent: text(raw.agent),
    assignedLocationId: text(raw.assignedLocationId),
    assignedLocationName: text(raw.assignedLocationName),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  };
}

function shapeLocation(raw: Record<string, unknown>): Location {
  return {
    id: String(raw.id),
    name: typeof raw.name === 'string' ? raw.name : 'Untitled plot',
    lat: num(raw.lat),
    lng: num(raw.lng),
    areaHectares: num(raw.areaHectares),
    crop: text(raw.crop),
    agent: text(raw.agent),
    ownerName: text(raw.ownerName),
    notes: text(raw.notes),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
  };
}

function shapeRequest(raw: Record<string, unknown>): ScheduleRequest {
  return {
    id: String(raw.id),
    sourceMessageId: text(raw.sourceMessageId),
    locationId: String(raw.locationId),
    locationName: typeof raw.locationName === 'string' ? raw.locationName : 'Plot',
    lat: num(raw.lat),
    lng: num(raw.lng),
    droneCount: Math.max(1, Math.round(num(raw.droneCount, 1))),
    agent: text(raw.agent),
    startsAt: typeof raw.startsAt === 'string' ? raw.startsAt : new Date().toISOString(),
    endsAt: typeof raw.endsAt === 'string' ? raw.endsAt : new Date().toISOString(),
    status: toRequestStatus(raw.status),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
  };
}

function shapeMission(raw: Record<string, unknown>): Mission {
  return {
    id: String(raw.id),
    requestId: String(raw.requestId),
    droneId: String(raw.droneId),
    droneName: typeof raw.droneName === 'string' ? raw.droneName : 'Drone',
    locationId: String(raw.locationId),
    locationName: typeof raw.locationName === 'string' ? raw.locationName : 'Plot',
    lat: num(raw.lat),
    lng: num(raw.lng),
    agent: text(raw.agent),
    status: toMissionStatus(raw.status),
    progress: Math.min(1, Math.max(0, num(raw.progress))),
    latNow: raw.latNow == null ? null : num(raw.latNow),
    lngNow: raw.lngNow == null ? null : num(raw.lngNow),
    battery: raw.battery == null ? null : Math.round(num(raw.battery)),
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : '',
    completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : null,
  };
}

function shapeState(raw: Record<string, unknown>): SchedulingState {
  const requests = Array.isArray(raw.requests) ? raw.requests : [];
  const missions = Array.isArray(raw.missions) ? raw.missions : [];
  const kafka = raw.kafka as { connected?: unknown } | null | undefined;
  return {
    requests: requests.map((item) => shapeRequest(item as Record<string, unknown>)),
    missions: missions.map((item) => shapeMission(item as Record<string, unknown>)),
    kafka: kafka && typeof kafka.connected === 'boolean' ? { connected: kafka.connected } : null,
    instances: typeof raw.instances === 'number' ? raw.instances : undefined,
  };
}

export const api = {
  async getDrones(): Promise<Drone[]> {
    const body = await request<{ drones?: unknown[] }>('/api/drones');
    return Array.isArray(body?.drones)
      ? body.drones.map((item) => shapeDrone(item as Record<string, unknown>))
      : [];
  },

  async getLocations(): Promise<Location[]> {
    const body = await request<{ locations?: unknown[] }>('/api/locations');
    return Array.isArray(body?.locations)
      ? body.locations.map((item) => shapeLocation(item as Record<string, unknown>))
      : [];
  },

  async createLocation(input: LocationInput): Promise<Location> {
    const body = await request<Record<string, unknown>>('/api/locations', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return shapeLocation(body);
  },

  async updateLocation(id: string, input: LocationInput): Promise<Location> {
    const body = await request<Record<string, unknown>>(`/api/locations/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
    return shapeLocation(body);
  },

  async deleteLocation(id: string): Promise<void> {
    await request<void>(`/api/locations/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async getState(): Promise<SchedulingState> {
    return shapeState(await request<Record<string, unknown>>('/api/scheduling/state'));
  },

  async createRequest(input: ScheduleInput): Promise<ScheduleRequest> {
    const body = await request<{ request?: Record<string, unknown> }>('/api/scheduling/requests', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (!body?.request) throw new ApiError(502, 'Scheduling service returned no request');
    return shapeRequest(body.request);
  },

  async cancelRequest(id: string): Promise<ScheduleRequest> {
    const body = await request<{ request?: Record<string, unknown> }>(
      `/api/scheduling/requests/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
    if (!body?.request) throw new ApiError(502, 'Scheduling service returned no request');
    return shapeRequest(body.request);
  },

  shapeState,
  shapeMission,
};
