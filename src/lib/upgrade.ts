import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { errorMessage, readEnvironmentVariable } from "./util.ts";

interface Version {
  major: number;
  minor: number;
  patch: number;
}

const NUMERIC_IDENTIFIER_PATTERN = String.raw`0|[1-9]\d*`;
const VERSION_RE = new RegExp(
  String.raw`^(${NUMERIC_IDENTIFIER_PATTERN})\.(${NUMERIC_IDENTIFIER_PATTERN})\.(${NUMERIC_IDENTIFIER_PATTERN})$`,
);

export function parseVersion(version: string): Version {
  const match = VERSION_RE.exec(version);
  if (!match) {
    throw new Error(`invalid version: ${JSON.stringify(version)}`);
  }
  return {
    // oxlint-disable typescript/no-non-null-assertion -- VERSION_RE guarantees groups 1–3 on match; group 4 is optional.
    major: Number.parseInt(match[1]!, 10),
    minor: Number.parseInt(match[2]!, 10),
    patch: Number.parseInt(match[3]!, 10),
    // oxlint-enable typescript/no-non-null-assertion
  };
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) {
      return left[key] > right[key] ? 1 : -1;
    }
  }
  return 0;
}

const DEFAULT_REGISTRY = "https://registry.npmjs.org";

export function normalizeRegistry(registry: string | undefined): string {
  return (registry ?? DEFAULT_REGISTRY).replace(/\/$/, "");
}

function encodePackageNameForRegistry(packageName: string): string {
  return encodeURIComponent(packageName).replace(/^%40/, "@");
}

export interface FetchOptions {
  timeoutMs: number;
  registry?: string | undefined;
}

export async function fetchLatestVersion(
  packageName: string,
  options: FetchOptions,
): Promise<string> {
  const registry = normalizeRegistry(options.registry);
  const url = `${registry}/${encodePackageNameForRegistry(packageName)}/latest`;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch (error) {
      throw new Error(`registry request failed: ${errorMessage(error)}`, { cause: error });
    }
    if (!response.ok) {
      throw new Error(`registry returned ${response.status} for ${url}`);
    }
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null || !("version" in body)) {
      throw new TypeError(`registry response missing 'version' field`);
    }
    const { version } = body;
    if (typeof version !== "string") {
      throw new TypeError(`registry response 'version' field is not a string`);
    }
    parseVersion(version);
    return version;
  } finally {
    clearTimeout(timer);
  }
}

export interface UpgradeCheckCacheEntry {
  latest: string;
  fetchedAt: number;
  registry: string;
}

export interface PrimeUpgradeCheckCacheOptions {
  path: string;
  latest: string;
  registry?: string | undefined;
  now: () => number;
}

export type UpgradeCheckCacheResult =
  | { kind: "missing" }
  | { kind: "fresh"; entry: UpgradeCheckCacheEntry }
  | { kind: "stale"; entry: UpgradeCheckCacheEntry };

export function defaultUpgradeCheckCachePath(): string {
  const override = readEnvironmentVariable("XDG_CACHE_HOME");
  const base =
    override === undefined || override.length === 0 ? join(homedir(), ".cache") : override;
  return join(base, "groundcrew", "upgrade-check.json");
}

function parseCacheEntry(value: unknown): UpgradeCheckCacheEntry | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = value as {
    latest?: unknown;
    fetchedAt?: unknown;
    registry?: unknown;
  };
  if (
    typeof candidate.latest !== "string" ||
    typeof candidate.fetchedAt !== "number" ||
    typeof candidate.registry !== "string"
  ) {
    return undefined;
  }
  try {
    parseVersion(candidate.latest);
  } catch {
    return undefined;
  }
  return { latest: candidate.latest, fetchedAt: candidate.fetchedAt, registry: candidate.registry };
}

export function readUpgradeCheckCache(
  path: string,
  options: { now: () => number; ttlMs: number; registry?: string | undefined },
): UpgradeCheckCacheResult {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { kind: "missing" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "missing" };
  }
  const entry = parseCacheEntry(parsed);
  if (!entry) {
    return { kind: "missing" };
  }
  if (entry.registry !== normalizeRegistry(options.registry)) {
    return { kind: "missing" };
  }
  const ageMs = options.now() - entry.fetchedAt;
  return ageMs >= options.ttlMs ? { kind: "stale", entry } : { kind: "fresh", entry };
}

export function writeUpgradeCheckCache(path: string, entry: UpgradeCheckCacheEntry): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(entry));
}

function writeUpgradeCheckCacheBestEffort(path: string, entry: UpgradeCheckCacheEntry): void {
  try {
    writeUpgradeCheckCache(path, entry);
  } catch {
    // Upgrade-check cache writes are best-effort; callers should keep using current data.
  }
}

export function primeUpgradeCheckCache(options: PrimeUpgradeCheckCacheOptions): void {
  writeUpgradeCheckCacheBestEffort(options.path, {
    latest: options.latest,
    fetchedAt: options.now(),
    registry: normalizeRegistry(options.registry),
  });
}

export function composeNudgeMessage(current: string, latest: string): string | undefined {
  if (compareVersions(current, latest) >= 0) {
    return undefined;
  }
  return `[crew] ${latest} available — run \`crew upgrade\` (you have ${current})`;
}

export type VersionFetcher = (packageName: string, options: FetchOptions) => Promise<string>;

export interface FetchAndPrimeUpgradeCheckCacheOptions {
  packageName: string;
  cachePath: string;
  fetchTimeoutMs: number;
  registry?: string | undefined;
  now: () => number;
  fetcher: VersionFetcher;
}

export async function fetchAndPrimeUpgradeCheckCache(
  options: FetchAndPrimeUpgradeCheckCacheOptions,
): Promise<string> {
  const latest = await options.fetcher(options.packageName, {
    timeoutMs: options.fetchTimeoutMs,
    registry: options.registry,
  });
  primeUpgradeCheckCache({
    path: options.cachePath,
    latest,
    registry: options.registry,
    now: options.now,
  });
  return latest;
}

export interface ComputeUpgradeNudgeOptions {
  currentVersion: string;
  packageName: string;
  cachePath: string;
  ttlMs: number;
  fetchTimeoutMs: number;
  registry?: string | undefined;
  noUpgradeCheck: boolean;
  now: () => number;
  fetcher: VersionFetcher;
}

export async function computeUpgradeNudge(
  options: ComputeUpgradeNudgeOptions,
): Promise<string | undefined> {
  if (options.noUpgradeCheck) {
    return undefined;
  }
  const cacheResult = readUpgradeCheckCache(options.cachePath, {
    now: options.now,
    ttlMs: options.ttlMs,
    registry: options.registry,
  });
  if (cacheResult.kind === "fresh") {
    return composeNudgeMessage(options.currentVersion, cacheResult.entry.latest);
  }
  try {
    const latest = await fetchAndPrimeUpgradeCheckCache(options);
    return composeNudgeMessage(options.currentVersion, latest);
  } catch {
    if (cacheResult.kind === "stale") {
      return composeNudgeMessage(options.currentVersion, cacheResult.entry.latest);
    }
    return undefined;
  }
}
