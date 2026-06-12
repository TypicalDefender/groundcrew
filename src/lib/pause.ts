/**
 * Crew-level pause: one JSON file beside the log and run states that tells
 * the orchestrator to skip dispatch/review/clean while the operator steps
 * away. Reading an expired pause deletes the file, so auto-wake needs no
 * timer — the first tick past the expiry resumes work.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ResolvedConfig } from "./config.ts";

export interface PauseState {
  pausedAt: string;
  /** ISO expiry; absent means paused until `crew wake`. */
  until?: string;
  reason?: string;
}

export function pausePath(config: Pick<ResolvedConfig, "logging">): string {
  return path.resolve(path.dirname(config.logging.file), "pause.json");
}

export interface RecordPauseInput {
  config: ResolvedConfig;
  until?: Date;
  reason?: string;
  now?: Date;
}

export function recordPause(input: RecordPauseInput): PauseState {
  const { config, until, reason, now = new Date() } = input;
  const state: PauseState = {
    pausedAt: now.toISOString(),
    ...(until === undefined ? {} : { until: until.toISOString() }),
    ...(reason === undefined ? {} : { reason }),
  };
  const filePath = pausePath(config);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(state, undefined, 2)}\n`, { mode: 0o600 });
  renameSync(tmpPath, filePath);
  return state;
}

export interface ClearPauseInput {
  config: ResolvedConfig;
}

/** Remove the pause file; reports whether the crew was actually paused. */
export function clearPause(input: ClearPauseInput): boolean {
  const state = readPauseFile(input.config);
  rmSync(pausePath(input.config), { force: true });
  return state !== undefined;
}

export interface ReadPauseInput {
  config: ResolvedConfig;
  now?: Date;
}

/**
 * The active pause, or undefined when the crew is awake. An expired or
 * malformed pause file is deleted on read (auto-wake / self-heal).
 */
export function readPause(input: ReadPauseInput): PauseState | undefined {
  const { config, now = new Date() } = input;
  const state = readPauseFile(config);
  if (state === undefined) {
    rmSync(pausePath(config), { force: true });
    return undefined;
  }
  if (state.until !== undefined && new Date(state.until).getTime() <= now.getTime()) {
    rmSync(pausePath(config), { force: true });
    return undefined;
  }
  return state;
}

function readPauseFile(config: ResolvedConfig): PauseState | undefined {
  let raw: string;
  try {
    raw = readFileSync(pausePath(config), "utf8");
  } catch {
    return undefined;
  }
  try {
    return parsePauseState(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePauseState(value: unknown): PauseState | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const pausedAt = isoField(value, "pausedAt");
  if (pausedAt === undefined) {
    return undefined;
  }
  const until = isoField(value, "until");
  const { reason } = value;
  return {
    pausedAt,
    ...(until === undefined ? {} : { until }),
    ...(typeof reason === "string" && reason.length > 0 ? { reason } : {}),
  };
}

function isoField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) {
    return undefined;
  }
  return value;
}
