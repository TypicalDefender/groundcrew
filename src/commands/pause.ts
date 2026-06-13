/**
 * `crew pause` / `crew wake` — the operator-level switch for the
 * orchestrator. Pausing writes the pause file; the watch loop sees it on
 * its next tick and skips dispatch/review/clean until the pause expires
 * (`--for`) or `crew wake` removes it.
 */

import { loadConfig } from "../lib/config.ts";
import { emitCrewEvent, initializeCrewEvents } from "../lib/crewEventBus.ts";
import { clearPause, type PauseState, recordPause } from "../lib/pause.ts";
import { log } from "../lib/util.ts";

const PAUSE_USAGE = "crew pause [--for <duration>] [--reason <text>]";

const MILLISECONDS_PER_UNIT: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Parse `90m`-style durations (s/m/h/d) into milliseconds. */
export function parseDurationMilliseconds(raw: string): number {
  const match = /^(?<count>\d+)(?<unit>[smhd])$/.exec(raw);
  const count = Number(match?.groups?.["count"]);
  const unitMilliseconds = MILLISECONDS_PER_UNIT[match?.groups?.["unit"] ?? ""];
  if (match === null || unitMilliseconds === undefined || count <= 0) {
    throw new Error(`crew pause --for: expected a duration like 30m, 2h, or 1d; got: ${raw}`);
  }
  return count * unitMilliseconds;
}

export interface PauseOptions {
  forMilliseconds?: number;
  reason?: string;
}

export function parsePauseArguments(argv: string[]): PauseOptions {
  let forMilliseconds: number | undefined;
  let reason: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--for") {
      const value = argv[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith("-")) {
        throw new Error(`crew pause --for: duration is required\nUsage: ${PAUSE_USAGE}`);
      }
      forMilliseconds = parseDurationMilliseconds(value);
      index += 1;
      continue;
    }
    if (argument === "--reason") {
      const value = argv[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith("-")) {
        throw new Error(`crew pause --reason: reason text is required\nUsage: ${PAUSE_USAGE}`);
      }
      reason = value;
      index += 1;
      continue;
    }
    throw new Error(`crew pause: unknown argument: ${argument}\nUsage: ${PAUSE_USAGE}`);
  }
  return {
    ...(forMilliseconds === undefined ? {} : { forMilliseconds }),
    ...(reason === undefined ? {} : { reason }),
  };
}

function describePause(state: PauseState): string {
  const expiry = state.until === undefined ? "until `crew wake`" : `until ${state.until}`;
  const reason = state.reason === undefined ? "" : ` — ${state.reason}`;
  return `Crew paused ${expiry}${reason}`;
}

export async function pauseCli(argv: string[]): Promise<void> {
  const options = parsePauseArguments(argv);
  const config = await loadConfig();
  const now = new Date();
  const until =
    options.forMilliseconds === undefined
      ? undefined
      : new Date(now.getTime() + options.forMilliseconds);
  const state = recordPause({
    config,
    now,
    ...(until === undefined ? {} : { until }),
    ...(options.reason === undefined ? {} : { reason: options.reason }),
  });
  log(describePause(state));
  log("The watch loop keeps ticking but skips dispatch/review/clean while paused.");
  await initializeCrewEvents(config);
  await emitCrewEvent({
    kind: "crew-paused",
    title: "Crew paused",
    body: describePause(state),
    now,
  });
}

export async function wakeCli(argv: string[]): Promise<void> {
  if (argv.length > 0) {
    throw new Error("Usage: crew wake");
  }
  const config = await loadConfig();
  const woke = clearPause({ config });
  log(woke ? "Crew is awake; the next tick resumes dispatch." : "Crew was not paused.");
  if (woke) {
    await initializeCrewEvents(config);
    await emitCrewEvent({
      kind: "crew-woken",
      title: "Crew woken",
      body: "Dispatch, review, and cleanup resume on the next tick.",
    });
  }
}
