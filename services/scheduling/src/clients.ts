// HTTP clients for the two sibling services. All calls are time-boxed and never
// throw: callers get `null` / a failure result and decide what to do.
import {
  DRONE_SERVICE_URL,
  LOCATION_SERVICE_URL,
  UUID_RE,
  errMessage,
  log,
} from "./config.ts";
import { decode, encode } from "./codec.ts";

const TIMEOUT_MS = 3000;
const MSGPACK = "application/msgpack";

export interface Location {
  id: string;
  name: string;
  lat: number;
  lng: number;
  agent: string | null;
}

export type LocationResult =
  | { ok: true; location: Location }
  | { ok: false; status: number; error: string };

export interface Drone {
  id: string;
  name: string;
  status: string;
  lat: number;
  lng: number;
  homeLat: number;
  homeLng: number;
  battery: number;
  agent: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/**
 * Reads a response body that was negotiated as MessagePack, falling back to
 * JSON when the peer answered with `application/json` (peer not msgpack-capable
 * or an error page). Returns `null` when the body cannot be parsed.
 */
async function readNegotiated(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes(MSGPACK)) {
    try {
      return decode(new Uint8Array(await response.arrayBuffer()));
    } catch (error) {
      log("warn", `failed to decode msgpack response: ${errMessage(error)}`);
      return null;
    }
  }
  return response.json().catch(() => null);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export async function fetchLocation(locationId: string): Promise<LocationResult> {
  const url = `${LOCATION_SERVICE_URL}/api/locations/${encodeURIComponent(locationId)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: MSGPACK },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      status: 400,
      error: `location service unreachable at ${LOCATION_SERVICE_URL} (${errMessage(error)})`,
    };
  }

  if (response.status === 404) {
    return { ok: false, status: 400, error: `location ${locationId} not found` };
  }
  if (!response.ok) {
    return {
      ok: false,
      status: 400,
      error: `location service responded ${response.status} for ${locationId}`,
    };
  }

  const body = asRecord(await readNegotiated(response));
  // Accept both `{location:{...}}` and the bare object.
  const raw = asRecord(body?.location) ?? body;
  const id = typeof raw?.id === "string" ? raw.id : locationId;
  const name = typeof raw?.name === "string" ? raw.name : "";
  const lat = asNumber(raw?.lat);
  const lng = asNumber(raw?.lng);

  if (!id || !name || lat === null || lng === null) {
    return {
      ok: false,
      status: 400,
      error: `location service returned an invalid payload for ${locationId}`,
    };
  }

  const agent = typeof raw?.agent === "string" && raw.agent.trim() ? raw.agent.trim() : null;
  return {
    ok: true,
    location: { id: UUID_RE.test(id) ? id : locationId, name, lat, lng, agent },
  };
}

export async function fetchDrones(): Promise<Drone[] | null> {
  let response: Response;
  try {
    response = await fetch(`${DRONE_SERVICE_URL}/api/drones`, {
      headers: { accept: MSGPACK },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    log("warn", `drone service unreachable at ${DRONE_SERVICE_URL}: ${errMessage(error)}`);
    return null;
  }

  if (!response.ok) {
    log("warn", `drone service responded ${response.status} on GET /api/drones`);
    return null;
  }

  const body = await readNegotiated(response);
  const list = Array.isArray(body)
    ? body
    : Array.isArray(asRecord(body)?.drones)
      ? (asRecord(body)?.drones as unknown[])
      : null;
  if (!list) {
    log("warn", "drone service returned an invalid payload on GET /api/drones");
    return null;
  }

  const drones: Drone[] = [];
  for (const entry of list) {
    const raw = asRecord(entry);
    if (!raw || typeof raw.id !== "string" || !UUID_RE.test(raw.id)) continue;
    const lat = asNumber(raw.lat);
    const lng = asNumber(raw.lng);
    if (lat === null || lng === null) continue;
    drones.push({
      id: raw.id,
      name: typeof raw.name === "string" ? raw.name : raw.id,
      status: typeof raw.status === "string" ? raw.status : "unknown",
      lat,
      lng,
      homeLat: asNumber(raw.homeLat) ?? lat,
      homeLng: asNumber(raw.homeLng) ?? lng,
      battery: Math.round(asNumber(raw.battery) ?? 100),
      agent: typeof raw.agent === "string" ? raw.agent : null,
    });
  }
  return drones;
}

async function sendPatch(
  label: string,
  url: string,
  body: string | Buffer,
  contentType: string,
): Promise<Response | null> {
  try {
    return await fetch(url, {
      method: "PATCH",
      headers: { "content-type": contentType },
      body: body as BodyInit,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    log("warn", `${label} failed: ${errMessage(error)}`);
    return null;
  }
}

export async function patchDrone(
  droneId: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const url = `${DRONE_SERVICE_URL}/api/drones/${encodeURIComponent(droneId)}`;
  const label = `PATCH drone ${droneId}`;

  // Preferred encoding first. Any non-2xx (415 included) means the peer is not
  // msgpack-capable yet, so retry exactly once with a JSON body.
  const packed = await sendPatch(`${label} (msgpack)`, url, encode(patch), MSGPACK);
  if (packed !== null && packed.ok) return true;
  if (packed !== null) {
    log("warn", `${label} msgpack responded ${packed.status}; retrying as JSON`);
  }

  const json = await sendPatch(`${label} (json)`, url, JSON.stringify(patch), "application/json");
  if (json === null) return false;
  if (!json.ok) {
    log("warn", `${label} responded ${json.status}`);
    return false;
  }
  return true;
}
