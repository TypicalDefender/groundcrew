/**
 * The cross-config registry behind the portfolio view: one JSON file in
 * the global state dir listing every crew config this machine has run.
 * `crew run` and `crew deck` register their config on startup, so
 * `crew deck --all` can aggregate every known fleet without any manual
 * bookkeeping.
 */

import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { xdgStatePath } from "./xdg.ts";

export interface RegisteredConfig {
  /** Absolute path to the crew config file. */
  path: string;
  /** Display name; defaults to the config's directory name. */
  name: string;
}

export function configRegistryPath(): string {
  return xdgStatePath("groundcrew", "configs.json");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEntry(raw: unknown): RegisteredConfig | undefined {
  if (!isPlainObject(raw)) {
    return undefined;
  }
  const { path: configPath, name } = raw;
  if (typeof configPath !== "string" || configPath === "" || typeof name !== "string") {
    return undefined;
  }
  return { path: configPath, name };
}

/** Every registered config; a missing or malformed registry reads as empty. */
export function readConfigRegistry(registryPath = configRegistryPath()): RegisteredConfig[] {
  let raw: string;
  try {
    raw = readFileSync(registryPath, "utf8");
  } catch {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed) || !Array.isArray(parsed["configs"])) {
      return [];
    }
    const entries: RegisteredConfig[] = [];
    for (const entry of parsed["configs"]) {
      const registered = parseEntry(entry);
      if (registered !== undefined) {
        entries.push(registered);
      }
    }
    return entries;
  } catch {
    return [];
  }
}

export interface RegisterConfigInput {
  path: string;
  name?: string;
  registryPath?: string;
}

/**
 * Add (or refresh the name of) one config path. Idempotent by resolved
 * path; never throws — registry bookkeeping must not break a crew run.
 */
export function registerConfig(input: RegisterConfigInput): RegisteredConfig[] {
  const registryPath = input.registryPath ?? configRegistryPath();
  let resolved = path.resolve(input.path);
  try {
    // Canonicalize through symlinks (macOS /tmp → /private/tmp) so the
    // same config never registers twice under two spellings.
    resolved = realpathSync(resolved);
  } catch {
    // Not on disk yet — keep the resolved spelling.
  }
  const name = input.name ?? path.basename(path.dirname(resolved));
  const entries = readConfigRegistry(registryPath).filter((entry) => entry.path !== resolved);
  entries.push({ path: resolved, name });
  entries.sort((left, right) => left.path.localeCompare(right.path));
  try {
    mkdirSync(path.dirname(registryPath), { recursive: true });
    const tmpPath = `${registryPath}.${process.pid}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify({ configs: entries }, undefined, 2)}\n`, {
      mode: 0o600,
    });
    renameSync(tmpPath, registryPath);
  } catch {
    // Best effort: a read-only state dir should not break the caller.
  }
  return entries;
}
