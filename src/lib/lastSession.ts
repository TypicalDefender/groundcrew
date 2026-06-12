/**
 * Stop-state snapshot: when the watch loop shuts down it records which
 * tasks were running (and their workspace names) in `last-session.json`
 * beside the run states. `crew run --watch --restore` reads it back and
 * resumes the tasks whose workspaces did not survive the gap — after a
 * reboot, the fleet picks up where it stopped. Tasks whose tmux windows
 * are still alive are left alone.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ResolvedConfig } from "./config.ts";
import type { RunState } from "./runState.ts";

export interface LastSessionTask {
  task: string;
  repository: string;
  agent: string;
  workspaceName: string;
}

export interface LastSession {
  stoppedAt: string;
  tasks: readonly LastSessionTask[];
}

export function lastSessionPath(config: Pick<ResolvedConfig, "logging">): string {
  return path.resolve(path.dirname(config.logging.file), "last-session.json");
}

/** The running/resumed slice of the fleet, in snapshot form. */
export function runningSessionTasks(runStates: readonly RunState[]): LastSessionTask[] {
  return runStates
    .filter((state) => state.state === "running" || state.state === "resumed")
    .map((state) => ({
      task: state.task,
      repository: state.repository,
      agent: state.agent,
      workspaceName: state.workspaceName,
    }));
}

export interface RecordLastSessionInput {
  config: ResolvedConfig;
  tasks: readonly LastSessionTask[];
  now?: Date;
}

/** Overwrites the previous snapshot; an empty task list is a clean stop. */
export function recordLastSession(input: RecordLastSessionInput): LastSession {
  const { config, tasks, now = new Date() } = input;
  const session: LastSession = { stoppedAt: now.toISOString(), tasks };
  const filePath = lastSessionPath(config);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(session, undefined, 2)}\n`, { mode: 0o600 });
  renameSync(tmpPath, filePath);
  return session;
}

export function clearLastSession(config: ResolvedConfig): void {
  rmSync(lastSessionPath(config), { force: true });
}

export function readLastSession(config: ResolvedConfig): LastSession | undefined {
  let raw: string;
  try {
    raw = readFileSync(lastSessionPath(config), "utf8");
  } catch {
    return undefined;
  }
  try {
    return parseLastSession(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

export interface RestoreSelectionInput {
  session: LastSession | undefined;
  /** Names of currently live workspaces (probe snapshot). */
  liveNames: ReadonlySet<string>;
  /** Current run states; a task without one was cleaned up — skip it. */
  runStates: readonly RunState[];
}

export interface RestoreSelection {
  resume: LastSessionTask[];
  stillLive: LastSessionTask[];
  cleanedUp: LastSessionTask[];
}

/** Pure selection: which snapshot tasks should `--restore` resume? */
export function selectRestoreTasks(input: RestoreSelectionInput): RestoreSelection {
  const selection: RestoreSelection = { resume: [], stillLive: [], cleanedUp: [] };
  if (input.session === undefined) {
    return selection;
  }
  const known = new Set(input.runStates.map((state) => state.task));
  for (const task of input.session.tasks) {
    if (input.liveNames.has(task.workspaceName)) {
      selection.stillLive.push(task);
    } else if (known.has(task.task)) {
      selection.resume.push(task);
    } else {
      selection.cleanedUp.push(task);
    }
  }
  return selection;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSessionTask(value: unknown): LastSessionTask | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const { task, repository, agent, workspaceName } = value;
  if (
    typeof task !== "string" ||
    typeof repository !== "string" ||
    typeof agent !== "string" ||
    typeof workspaceName !== "string"
  ) {
    return undefined;
  }
  return { task, repository, agent, workspaceName };
}

function parseLastSession(value: unknown): LastSession | undefined {
  if (!isPlainObject(value) || typeof value["stoppedAt"] !== "string") {
    return undefined;
  }
  const rawTasks = value["tasks"];
  if (!Array.isArray(rawTasks)) {
    return undefined;
  }
  const tasks: LastSessionTask[] = [];
  for (const raw of rawTasks) {
    const task = parseSessionTask(raw);
    if (task === undefined) {
      return undefined;
    }
    tasks.push(task);
  }
  return { stoppedAt: value["stoppedAt"], tasks };
}
