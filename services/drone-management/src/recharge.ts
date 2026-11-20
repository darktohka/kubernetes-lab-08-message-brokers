import { sql } from "./db.ts";

const RECHARGE_INTERVAL_MS = 5000;

/**
 * Idle drones recharge at the base: +1 battery point per tick, capped at 100.
 * A single periodic UPDATE keeps this cheap. No per-drone logging.
 */
async function rechargeIdleDrones(): Promise<void> {
  try {
    await sql`
      UPDATE drones
      SET battery = LEAST(battery + 1, 100), updated_at = now()
      WHERE status = 'idle' AND battery < 100`;
  } catch (err) {
    console.warn("[recharge] idle recharge sweep failed:", (err as Error).message);
  }
}

/** Start the 5s idle-recharge sweep; returns a stop function for shutdown. */
export function startRecharge(): () => void {
  const timer = setInterval(() => void rechargeIdleDrones(), RECHARGE_INTERVAL_MS);
  return () => clearInterval(timer);
}
