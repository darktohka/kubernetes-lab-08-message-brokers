// Database row types, camelCase wire mapping and the aggregated state payload.
import { sql } from "./db.ts";
import { isKafkaConnected } from "./kafka.ts";

export type RequestStatus = "queued" | "assigned" | "done" | "cancelled";

export type MissionStatus =
  | "assigned"
  | "enroute"
  | "spraying"
  | "returning"
  | "done"
  | "cancelled";

/** Mission statuses that mean "this drone is busy". */
export const ACTIVE_MISSION_STATUSES: MissionStatus[] = [
  "assigned",
  "enroute",
  "spraying",
  "returning",
];

export interface RequestRow {
  id: string;
  source_message_id: string | null;
  location_id: string;
  location_name: string;
  lat: number;
  lng: number;
  drone_count: number;
  agent: string | null;
  starts_at: Date;
  ends_at: Date;
  status: RequestStatus;
  created_at: Date;
}

export interface MissionRow {
  id: string;
  request_id: string;
  drone_id: string;
  drone_name: string;
  location_id: string;
  location_name: string;
  lat: number;
  lng: number;
  agent: string | null;
  status: MissionStatus;
  progress: number;
  lat_now: number | null;
  lng_now: number | null;
  battery: number | null;
  battery_start: number | null;
  started_at: Date;
  completed_at: Date | null;
  phase_started_at: Date | null;
}

export interface WireRequest {
  id: string;
  sourceMessageId: string | null;
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

export interface WireMission {
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
  batteryStart: number | null;
  startedAt: string;
  completedAt: string | null;
  phaseStartedAt: string | null;
}

export interface StatePayload {
  requests: WireRequest[];
  missions: WireMission[];
  kafka: { connected: boolean };
  instances: number;
}

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isoRequired(value: Date | string): string {
  return iso(value) ?? new Date(0).toISOString();
}

export function toWireRequest(row: RequestRow): WireRequest {
  return {
    id: row.id,
    sourceMessageId: row.source_message_id,
    locationId: row.location_id,
    locationName: row.location_name,
    lat: row.lat,
    lng: row.lng,
    droneCount: row.drone_count,
    agent: row.agent,
    startsAt: isoRequired(row.starts_at),
    endsAt: isoRequired(row.ends_at),
    status: row.status,
    createdAt: isoRequired(row.created_at),
  };
}

export function toWireMission(row: MissionRow): WireMission {
  return {
    id: row.id,
    requestId: row.request_id,
    droneId: row.drone_id,
    droneName: row.drone_name,
    locationId: row.location_id,
    locationName: row.location_name,
    lat: row.lat,
    lng: row.lng,
    agent: row.agent,
    status: row.status,
    progress: row.progress,
    latNow: row.lat_now,
    lngNow: row.lng_now,
    battery: row.battery,
    batteryStart: row.battery_start,
    startedAt: isoRequired(row.started_at),
    completedAt: iso(row.completed_at),
    phaseStartedAt: iso(row.phase_started_at),
  };
}

export async function listRequests(): Promise<RequestRow[]> {
  return sql<RequestRow[]>`
    SELECT * FROM schedule_requests ORDER BY created_at DESC, id DESC
  `;
}

export async function listMissions(): Promise<MissionRow[]> {
  return sql<MissionRow[]>`SELECT * FROM missions ORDER BY started_at DESC, id DESC`;
}

export async function getState(): Promise<StatePayload> {
  const [requests, missions] = await Promise.all([listRequests(), listMissions()]);
  return {
    requests: requests.map(toWireRequest),
    missions: missions.map(toWireMission),
    kafka: { connected: isKafkaConnected() },
    instances: 1,
  };
}
