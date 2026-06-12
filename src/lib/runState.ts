import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ResolvedConfig } from "./config.ts";
// Type-only: erased at compile time, so no runtime cycle with pulse.ts
// (which imports this module for run-state reads).
import type { PulseState } from "./pulse.ts";
import { isPlainTaskId, normalizePlainTaskId } from "./taskId.ts";

export type RunLifecycleState = "running" | "interrupted" | "resumed" | "failed-to-launch";

export interface RunState {
  task: string;
  repository: string;
  agent: string;
  worktreeDir: string;
  branchName: string;
  workspaceName: string;
  state: RunLifecycleState;
  createdAt: string;
  updatedAt: string;
  resumeCount: number;
  reason?: string;
  detail?: string;
  /**
   * Task title at dispatch time. Cached so `crew status` can render it
   * without re-hitting the task source; lifecycle transitions
   * (resume/interrupt) that omit the field preserve the on-disk value.
   */
  title?: string;
  /**
   * Direct task URL at dispatch time. Same caching rationale as `title`;
   * the source adapter populates it when it can (e.g., Linear), otherwise
   * the field stays undefined and `crew status` falls back to displaying
   * just the task id.
   */
  url?: string;
  /**
   * Canonical source-prefixed id used for no-PR self-completion. Cached so
   * resumed workers keep the same completion target as the original launch.
   */
  completionTaskId?: string;
  /**
   * Last observed pulse (activity state). Written by `recordTaskPulse`
   * whenever a consumer reads the pulse; lifecycle transitions preserve it.
   */
  pulse?: PulseState;
  /** When the pulse last changed value (not when it was last observed). */
  pulseChangedAt?: string;
}

export interface RunStateDraft {
  task: string;
  repository: string;
  agent: string;
  worktreeDir: string;
  branchName: string;
  workspaceName: string;
  state: RunLifecycleState;
  reason?: string;
  detail?: string;
  resumeCount?: number;
  title?: string;
  url?: string;
  completionTaskId?: string;
}

export interface RecordRunStateInput {
  config: ResolvedConfig;
  state: RunStateDraft;
}

export interface UpdateRunStateInput {
  config: ResolvedConfig;
  task: string;
  patch: Partial<Omit<RunState, "createdAt" | "task">> & {
    state: RunLifecycleState;
  };
}

const RUN_STATE_DIRECTORY_NAME = "runs";

function taskKey(task: string): string {
  return normalizePlainTaskId(task);
}

export function runStateDirectory(config: Pick<ResolvedConfig, "logging">): string {
  return path.resolve(path.dirname(config.logging.file), RUN_STATE_DIRECTORY_NAME);
}

export function runStatePath(config: Pick<ResolvedConfig, "logging">, task: string): string {
  return path.resolve(runStateDirectory(config), `${taskKey(task)}.json`);
}

function nowIso(): string {
  return new Date().toISOString();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}

function isRunLifecycleState(value: unknown): value is RunLifecycleState {
  return (
    value === "running" ||
    value === "interrupted" ||
    value === "resumed" ||
    value === "failed-to-launch"
  );
}

// Record<PulseState, true> so adding a state to the union without updating
// this map is a compile error in both directions.
const PULSE_STATE_SET: Record<PulseState, true> = {
  active: true,
  ready: true,
  idle: true,
  "awaiting-input": true,
  blocked: true,
  gone: true,
};

function isPulseState(value: unknown): value is PulseState {
  return typeof value === "string" && value in PULSE_STATE_SET;
}

interface OptionalRunStateFields {
  reason: string | undefined;
  detail: string | undefined;
  title: string | undefined;
  url: string | undefined;
  completionTaskId: string | undefined;
  pulse: PulseState | undefined;
  pulseChangedAt: string | undefined;
}

/** Spread-ready subset containing only the optional fields that are present. */
function presentOptionalFields(fields: OptionalRunStateFields): Partial<RunState> {
  return {
    ...(fields.reason === undefined ? {} : { reason: fields.reason }),
    ...(fields.detail === undefined ? {} : { detail: fields.detail }),
    ...(fields.title === undefined ? {} : { title: fields.title }),
    ...(fields.url === undefined ? {} : { url: fields.url }),
    ...(fields.completionTaskId === undefined ? {} : { completionTaskId: fields.completionTaskId }),
    ...(fields.pulse === undefined ? {} : { pulse: fields.pulse }),
    ...(fields.pulseChangedAt === undefined ? {} : { pulseChangedAt: fields.pulseChangedAt }),
  };
}

function parseRunState(value: unknown): RunState | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const task = stringField(value, "task");
  const repository = stringField(value, "repository");
  const agent = stringField(value, "agent") ?? stringField(value, "model");
  const worktreeDir = stringField(value, "worktreeDir");
  const branchName = stringField(value, "branchName");
  const workspaceName = stringField(value, "workspaceName");
  const { state, resumeCount } = value;
  const createdAt = stringField(value, "createdAt");
  const updatedAt = stringField(value, "updatedAt");
  const reason = stringField(value, "reason");
  const detail = stringField(value, "detail");
  const title = stringField(value, "title");
  const url = stringField(value, "url");
  const completionTaskId = stringField(value, "completionTaskId");
  // An unknown pulse value degrades to "no recorded pulse", not a corrupt record.
  const pulse = isPulseState(value["pulse"]) ? value["pulse"] : undefined;
  const pulseChangedAt = stringField(value, "pulseChangedAt");
  if (
    task === undefined ||
    repository === undefined ||
    agent === undefined ||
    worktreeDir === undefined ||
    branchName === undefined ||
    workspaceName === undefined ||
    !isRunLifecycleState(state) ||
    createdAt === undefined ||
    updatedAt === undefined ||
    typeof resumeCount !== "number" ||
    !Number.isInteger(resumeCount) ||
    resumeCount < 0
  ) {
    return undefined;
  }
  return {
    task,
    repository,
    agent,
    worktreeDir,
    branchName,
    workspaceName,
    state,
    createdAt,
    updatedAt,
    resumeCount,
    ...presentOptionalFields({
      reason,
      detail,
      title,
      url,
      completionTaskId,
      pulse,
      pulseChangedAt,
    }),
  };
}

function writeState(config: ResolvedConfig, state: RunState): void {
  const statePath = runStatePath(config, state.task);
  mkdirSync(path.dirname(statePath), { recursive: true });
  const tmpPath = `${statePath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(state, undefined, 2)}\n`, { mode: 0o600 });
  renameSync(tmpPath, statePath);
}

export function readRunState(config: ResolvedConfig, task: string): RunState | undefined {
  let raw: string;
  try {
    raw = readFileSync(runStatePath(config, task), "utf8");
  } catch {
    return undefined;
  }
  try {
    return parseRunState(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

/**
 * Read every parseable run state in the state directory, sorted by task id.
 * Files that aren't `<task>.json` or fail to parse are skipped — a corrupt
 * record degrades to "no run state" exactly as it does in `readRunState`.
 * A missing directory means no task has ever been dispatched: empty fleet.
 */
export function listRunStates(config: ResolvedConfig): RunState[] {
  let fileNames: string[];
  try {
    fileNames = readdirSync(runStateDirectory(config));
  } catch {
    return [];
  }
  const states: RunState[] = [];
  for (const fileName of fileNames) {
    if (!fileName.endsWith(".json")) {
      continue;
    }
    const task = fileName.slice(0, -".json".length);
    if (!isPlainTaskId(task)) {
      continue;
    }
    const state = readRunState(config, task);
    if (state !== undefined) {
      states.push(state);
    }
  }
  return states.toSorted((left, right) => left.task.localeCompare(right.task));
}

export function recordRunState(input: RecordRunStateInput): RunState {
  const existing = readRunState(input.config, input.state.task);
  const timestamp = nowIso();
  // Resume/interrupt callers don't know the title or url, so they omit
  // them. Fall back to the on-disk value so cached display fields survive
  // transitions.
  const title = input.state.title ?? existing?.title;
  const url = input.state.url ?? existing?.url;
  const completionTaskId = input.state.completionTaskId ?? existing?.completionTaskId;
  // Pulse fields are only ever written by recordTaskPulse; lifecycle
  // transitions must not erase the last observed activity.
  const pulse = existing?.pulse;
  const pulseChangedAt = existing?.pulseChangedAt;
  const state: RunState = {
    task: taskKey(input.state.task),
    repository: input.state.repository,
    agent: input.state.agent,
    worktreeDir: input.state.worktreeDir,
    branchName: input.state.branchName,
    workspaceName: input.state.workspaceName,
    state: input.state.state,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    resumeCount: input.state.resumeCount ?? existing?.resumeCount ?? 0,
    ...presentOptionalFields({
      reason: input.state.reason,
      detail: input.state.detail,
      title,
      url,
      completionTaskId,
      pulse,
      pulseChangedAt,
    }),
  };
  writeState(input.config, state);
  return state;
}

export interface RecordTaskPulseInput {
  config: ResolvedConfig;
  task: string;
  pulse: PulseState;
  /** Clock for the transition timestamp; defaults to now. */
  observedAt?: string;
}

/**
 * Persist the last observed pulse on the task's run state. `pulseChangedAt`
 * only moves when the pulse value actually changes, so it records the
 * transition time, not the observation time. Deliberately does NOT bump
 * `updatedAt` — that field tracks lifecycle transitions, and pulse writes
 * happen on every status read. No-op when the task has no run state.
 */
export function recordTaskPulse(input: RecordTaskPulseInput): RunState | undefined {
  const existing = readRunState(input.config, input.task);
  if (existing === undefined) {
    return undefined;
  }
  const observedAt = input.observedAt ?? nowIso();
  const pulseChangedAt =
    existing.pulse === input.pulse ? (existing.pulseChangedAt ?? observedAt) : observedAt;
  const state: RunState = { ...existing, pulse: input.pulse, pulseChangedAt };
  writeState(input.config, state);
  return state;
}

export function updateRunState(input: UpdateRunStateInput): RunState | undefined {
  const existing = readRunState(input.config, input.task);
  if (existing === undefined) {
    return undefined;
  }
  const state: RunState = {
    ...existing,
    ...input.patch,
    task: existing.task,
    createdAt: existing.createdAt,
    updatedAt: nowIso(),
  };
  writeState(input.config, state);
  return state;
}

export function removeRunState(config: ResolvedConfig, task: string): void {
  rmSync(runStatePath(config, task), { force: true });
}
