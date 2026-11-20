export type DroneStatus = 'idle' | 'assigned' | 'enroute' | 'spraying' | 'returning';
export type MissionStatus = 'assigned' | 'enroute' | 'spraying' | 'returning' | 'done';
export type RequestStatus = 'queued' | 'assigned' | 'done' | 'cancelled';

export interface Drone {
  id: string;
  name: string;
  model: string;
  status: DroneStatus;
  lat: number;
  lng: number;
  homeLat: number;
  homeLng: number;
  battery: number;
  agent: string | null;
  assignedLocationId: string | null;
  assignedLocationName: string | null;
  updatedAt: string;
}

export interface Location {
  id: string;
  name: string;
  lat: number;
  lng: number;
  areaHectares: number;
  crop: string | null;
  agent: string | null;
  ownerName: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocationInput {
  name: string;
  lat: number;
  lng: number;
  areaHectares: number;
  crop: string | null;
  agent: string | null;
  ownerName: string | null;
  notes?: string | null;
}

export interface ScheduleRequest {
  id: string;
  sourceMessageId?: string | null;
  locationId: string;
  locationName: string;
  lat: number;
  lng: number;
  droneCount: number;
  agent: string | null;
  startsAt: string;
  endsAt: string;
  status: RequestStatus;
  createdAt: string;
}

export interface Mission {
  id: string;
  requestId: string;
  droneId: string;
  droneName: string;
  locationId: string;
  locationName: string;
  lat: number;
  lng: number;
  agent: string | null;
  status: MissionStatus;
  progress: number;
  latNow: number | null;
  lngNow: number | null;
  battery: number | null;
  startedAt: string;
  completedAt: string | null;
}

export interface LivePosition {
  droneId: string;
  missionId?: string | null;
  lat: number;
  lng: number;
  battery: number;
  status: DroneStatus;
  progress?: number;
  ts?: number;
}

export interface SchedulingState {
  requests: ScheduleRequest[];
  missions: Mission[];
  kafka?: { connected: boolean } | null;
  instances?: number;
}

export interface ScheduleInput {
  locationId: string;
  droneCount: number;
  agent: string | null;
  startsAt: string;
  endsAt: string;
}

export interface FlyTarget {
  lat: number;
  lng: number;
  zoom?: number;
  nonce: number;
}

export type Connection = 'connecting' | 'live' | 'reconnecting' | 'offline';

export type DraftMode = 'create' | 'edit';

export interface DraftFields {
  name: string;
  areaHectares: string;
  crop: string;
  agent: string;
  ownerName: string;
}

export interface LocationDraft {
  mode: DraftMode;
  id?: string;
  lat: number | null;
  lng: number | null;
  formOpen: boolean;
  fields: DraftFields;
}

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

const DRONE_STATUSES: readonly string[] = ['idle', 'assigned', 'enroute', 'spraying', 'returning'];

export function toDroneStatus(value: unknown): DroneStatus {
  return typeof value === 'string' && DRONE_STATUSES.includes(value)
    ? (value as DroneStatus)
    : 'idle';
}

export function toMissionStatus(value: unknown): MissionStatus {
  const allowed = ['assigned', 'enroute', 'spraying', 'returning', 'done'];
  return typeof value === 'string' && allowed.includes(value) ? (value as MissionStatus) : 'assigned';
}

export function toRequestStatus(value: unknown): RequestStatus {
  const allowed = ['queued', 'assigned', 'done', 'cancelled'];
  return typeof value === 'string' && allowed.includes(value) ? (value as RequestStatus) : 'queued';
}
