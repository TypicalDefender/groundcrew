/**
 * `crew snooze <task> --until <time|duration>` / `crew snooze <task>
 * --clear` — a per-task hold stored on the run state. Dispatch eligibility
 * skips a snoozed task until the expiry passes; the reviewer still
 * observes its pull request. Expired snoozes are simply ignored, so
 * clearing is only needed to wake a task early.
 */

import { loadConfig } from "../lib/config.ts";
import { recordTaskSnooze } from "../lib/runState.ts";
import { log } from "../lib/util.ts";
import { parseDurationMilliseconds } from "./pause.ts";

const SNOOZE_USAGE = "crew snooze <task> (--until <time|duration> | --clear)";

/** `--until` accepts a duration (`45m`, `2h`, `1d`) or an absolute time. */
export function parseSnoozeUntil(raw: string, now: Date): Date {
  if (/^\d+[smhd]$/.test(raw)) {
    return new Date(now.getTime() + parseDurationMilliseconds(raw));
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(
      `crew snooze --until: expected a duration like 2h or a timestamp; got: ${raw}`,
    );
  }
  if (parsed.getTime() <= now.getTime()) {
    throw new Error(`crew snooze --until: ${raw} is not in the future`);
  }
  return parsed;
}

export type SnoozeOptions =
  | { task: string; clear: true }
  | { task: string; clear: false; until: string };

export function parseSnoozeArguments(argv: string[]): SnoozeOptions {
  let until: string | undefined;
  let clear = false;
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    /* v8 ignore next 3 @preserve -- loop bounds ensure argv[index] exists; guard satisfies noUncheckedIndexedAccess */
    if (argument === undefined) {
      continue;
    }
    if (argument === "--until") {
      const value = argv[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith("-")) {
        throw new Error(
          `crew snooze --until: a time or duration is required\nUsage: ${SNOOZE_USAGE}`,
        );
      }
      until = value;
      index += 1;
      continue;
    }
    if (argument === "--clear") {
      clear = true;
      continue;
    }
    if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}\nUsage: ${SNOOZE_USAGE}`);
    }
    positionals.push(argument);
  }
  const [task, ...extras] = positionals;
  if (task === undefined || task.length === 0 || extras.length > 0) {
    throw new Error(`Usage: ${SNOOZE_USAGE}`);
  }
  if (clear === (until !== undefined)) {
    throw new Error(`crew snooze: pass exactly one of --until or --clear\nUsage: ${SNOOZE_USAGE}`);
  }
  if (until === undefined) {
    return { task: task.toLowerCase(), clear: true };
  }
  return { task: task.toLowerCase(), clear: false, until };
}

export async function snoozeCli(argv: string[]): Promise<void> {
  const options = parseSnoozeArguments(argv);
  const config = await loadConfig();

  if (options.clear) {
    const state = recordTaskSnooze({ config, task: options.task });
    if (state === undefined) {
      throw new Error(`No run state for ${options.task}; nothing to clear.`);
    }
    log(`Cleared the snooze on ${options.task}; the next tick may dispatch it again.`);
    return;
  }

  const until = parseSnoozeUntil(options.until, new Date());
  const state = recordTaskSnooze({ config, task: options.task, until });
  if (state === undefined) {
    throw new Error(
      `No run state for ${options.task} — snooze applies to tasks the crew has dispatched at least once.`,
    );
  }
  log(
    `Snoozed ${options.task} until ${until.toISOString()}; dispatch skips it (the reviewer still watches its PR).`,
  );
}
