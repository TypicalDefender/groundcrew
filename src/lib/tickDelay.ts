/**
 * Watch-loop pacing — one pure function that picks the next tick delay
 * from the operator's clock and the fleet's state:
 *
 * 1. any `active` pulse (and not paused) → `activePollIntervalMilliseconds`
 * 2. inside quiet hours → `quietHours.pollIntervalMilliseconds`
 * 3. otherwise → `pollIntervalMilliseconds`
 *
 * A paused crew never fast-ticks (nothing will be dispatched anyway) but
 * still honors quiet hours, so an overnight pause stays cheap.
 */

import type { QuietHoursConfig, ResolvedConfig } from "./config.ts";
import type { RunState } from "./runState.ts";

export interface FleetPacingSignals {
  /** Run states as of this tick; only the `pulse` fields matter here. */
  runStates: readonly RunState[];
  /** Crew-level pause (see `readPause`). */
  paused: boolean;
}

const MINUTES_PER_HOUR = 60;

function minutesOfDay(now: Date): number {
  return now.getHours() * MINUTES_PER_HOUR + now.getMinutes();
}

function parseMinutes(time: string): number {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return hours * MINUTES_PER_HOUR + minutes;
}

/** Start-inclusive, end-exclusive, in local time; wraps past midnight. */
export function isWithinQuietHours(
  now: Date,
  quietHours: Pick<QuietHoursConfig, "start" | "end">,
): boolean {
  const minute = minutesOfDay(now);
  const start = parseMinutes(quietHours.start);
  const end = parseMinutes(quietHours.end);
  if (start === end) {
    // Degenerate window — treat as "no quiet hours" instead of "always".
    return false;
  }
  if (start < end) {
    return minute >= start && minute < end;
  }
  return minute >= start || minute < end;
}

export function nextTickDelay(
  now: Date,
  fleet: FleetPacingSignals,
  config: ResolvedConfig,
): number {
  const { orchestrator } = config;
  if (
    !fleet.paused &&
    orchestrator.activePollIntervalMilliseconds !== undefined &&
    fleet.runStates.some((state) => state.pulse === "active")
  ) {
    return orchestrator.activePollIntervalMilliseconds;
  }
  if (orchestrator.quietHours !== undefined && isWithinQuietHours(now, orchestrator.quietHours)) {
    return orchestrator.quietHours.pollIntervalMilliseconds;
  }
  return orchestrator.pollIntervalMilliseconds;
}
