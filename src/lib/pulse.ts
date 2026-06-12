/**
 * Pulse — activity detection for a task's workspace. Answers "what is the
 * agent doing right now?" with a probe cascade:
 *
 *   1. Workspace liveness — a missing or exited workspace is `gone`.
 *   2. Agent-native signal — the agent's own session log on disk (Claude
 *      Code's per-project JSONL, codex's rollout files), classified by age
 *      and error markers. The freshest, most trustworthy signal.
 *   3. Pane fallback — a hash of the captured pane text memoized in the
 *      state dir; the time since the pane last changed decays the state
 *      from `active` through `ready` to `idle`.
 *
 * A pane that ends in a prompt (question, y/n, numbered picker) upgrades a
 * `ready`/`idle` verdict to `awaiting-input` — agents waiting on the
 * operator look quiet in every other signal. Pure decision helpers live at
 * the top; I/O probes at the bottom mirror `eligibility.ts`'s split.
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { ResolvedConfig } from "./config.ts";
import { readRunState, type RunState, runStateDirectory } from "./runState.ts";
import { debug, errorMessage } from "./util.ts";
import { type WorkspaceProbe, workspaces } from "./workspaces.ts";
import { resolveLaunchDir } from "./worktrees.ts";

export type PulseState = "active" | "ready" | "idle" | "awaiting-input" | "blocked" | "gone";

export type PulseSource = "workspace" | "agent-native" | "pane";

export interface Pulse {
  state: PulseState;
  /** Which probe produced the verdict. */
  source: PulseSource;
  /** ISO timestamp of the underlying signal, when one exists. */
  observedAt?: string;
  detail?: string;
}

/** Every pulse threshold in one place. */
export const PULSE_THRESHOLDS = {
  /** A signal younger than this means the agent is actively working. */
  activeWindowMilliseconds: 30_000,
  /** Younger than this (but past the active window) means recently finished. */
  readyWindowMilliseconds: 300_000,
} as const;

export interface ReadPulseInput {
  config: ResolvedConfig;
  task: string;
  /** Pass when already loaded (e.g. by the fleet snapshot) to skip a re-read. */
  runState?: RunState;
  /** Pass a fresh probe to avoid one workspace-list call per task. */
  probe?: WorkspaceProbe;
  signal?: AbortSignal;
  /** Test seam: where agent session logs live. Defaults to the real home dir. */
  homeDirectory?: string;
  /** Test seam: clock for age math. Defaults to Date.now(). */
  now?: number;
}

export async function readPulse(input: ReadPulseInput): Promise<Pulse> {
  const { config, task, signal } = input;
  const now = input.now ?? Date.now();
  const homeDirectory = input.homeDirectory ?? homedir();

  const probe = input.probe ?? (await workspaces.probe(config, signal));
  const goneVerdict = classifyGone(probe, task);
  if (goneVerdict !== undefined) {
    return goneVerdict;
  }

  const paneText = await workspaces.capturePane(config, task, signal);
  const native = readNativeSignal({ config, task, runState: input.runState, homeDirectory, now });

  // Active and blocked are definitive; ready/idle can be upgraded by a
  // visible prompt, because an agent waiting on the operator stops writing
  // to its session log and looks quiet to every other signal.
  if (native !== undefined && (native.state === "active" || native.state === "blocked")) {
    return native;
  }
  if (paneText !== undefined && detectAwaitingInput(paneText)) {
    return { state: "awaiting-input", source: "pane", detail: "prompt visible in pane" };
  }
  if (native !== undefined) {
    return native;
  }
  if (paneText !== undefined) {
    return decayFromPaneMemo({ config, task, paneText, now });
  }
  return { state: "idle", source: "pane", detail: "no activity signal available" };
}

/**
 * `gone` verdict from the workspace probe, or undefined when the workspace
 * is live or the probe couldn't answer (an unavailable probe must never be
 * read as "no workspace").
 */
function classifyGone(probe: WorkspaceProbe, task: string): Pulse | undefined {
  if (probe.kind === "unavailable") {
    return undefined;
  }
  if (!probe.names.has(task)) {
    return { state: "gone", source: "workspace", detail: "no workspace session" };
  }
  if (probe.exitedNames?.has(task) === true) {
    return { state: "gone", source: "workspace", detail: "workspace session exited" };
  }
  return undefined;
}

/** Age-based decay shared by the native and pane probes. */
export function decayByAge(ageMilliseconds: number): "active" | "ready" | "idle" {
  if (ageMilliseconds <= PULSE_THRESHOLDS.activeWindowMilliseconds) {
    return "active";
  }
  if (ageMilliseconds <= PULSE_THRESHOLDS.readyWindowMilliseconds) {
    return "ready";
  }
  return "idle";
}

// Conservative prompt shapes: interactive confirmations, shell-style y/n
// suffixes, and TUI numbered pickers. Only the pane tail is scanned so a
// prompt buried in old scrollback can't pin a task at awaiting-input.
const AWAITING_INPUT_PATTERNS: readonly RegExp[] = [
  /\((?:y\/n|yes\/no)\)\??\s*$/i,
  /\[(?:y\/n|yes\/no)]\??\s*$/i,
  /do you want to/i,
  /would you like to/i,
  /waiting for your (?:input|confirmation|approval)/i,
  /press enter to (?:continue|confirm)/i,
  /❯\s*1\./,
];

const AWAITING_INPUT_SCAN_LINES = 20;

/** Whether the tail of the captured pane looks like a prompt for the operator. */
export function detectAwaitingInput(paneText: string): boolean {
  const tail = paneText
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-AWAITING_INPUT_SCAN_LINES)
    .join("\n");
  return AWAITING_INPUT_PATTERNS.some((pattern) => pattern.test(tail));
}

/**
 * Claude Code's on-disk project slug: every character outside [a-zA-Z0-9-]
 * becomes `-`. Callers must resolve symlinks first — Claude slugs the real
 * path, so a symlinked worktree would otherwise miss the directory.
 */
export function claudeProjectSlug(launchDir: string): string {
  return launchDir.replaceAll(/[^a-zA-Z0-9-]/g, "-");
}

/** Where pulse memoizes per-task pane hashes (sibling of the runs dir). */
export function pulseDirectory(config: Pick<ResolvedConfig, "logging">): string {
  return path.resolve(path.dirname(runStateDirectory(config)), "pulse");
}

// --- agent-native signal ------------------------------------------------------

interface NativeSignalInput {
  config: ResolvedConfig;
  task: string;
  runState: RunState | undefined;
  homeDirectory: string;
  now: number;
}

function readNativeSignal(input: NativeSignalInput): Pulse | undefined {
  const { config, task, homeDirectory, now } = input;
  const runState = input.runState ?? readRunState(config, task);
  if (runState === undefined) {
    return undefined;
  }
  const launchDir = launchDirFor(config, runState);
  const kind = agentKindFor(config, runState.agent);
  if (kind === "claude") {
    return readClaudeSignal({ launchDir, homeDirectory, now });
  }
  if (kind === "codex") {
    return readCodexSignal({ config, task, launchDir, homeDirectory, now });
  }
  return undefined;
}

/**
 * The directory the agent actually runs in: the worktree root unless the
 * repo recipe re-roots into a subdirectory. Falls back to the recorded
 * worktree dir when the repository is no longer in the config.
 */
function launchDirFor(config: ResolvedConfig, runState: RunState): string {
  try {
    return resolveLaunchDir(config, runState.repository, runState.worktreeDir);
  } catch {
    return runState.worktreeDir;
  }
}

function agentKindFor(config: ResolvedConfig, agentName: string): "claude" | "codex" | undefined {
  const definition = config.agents.definitions[agentName];
  const haystack = `${agentName} ${definition?.cmd ?? ""}`.toLowerCase();
  if (haystack.includes("claude")) {
    return "claude";
  }
  if (haystack.includes("codex")) {
    return "codex";
  }
  return undefined;
}

function realpathOrSelf(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}

interface ClaudeSignalInput {
  launchDir: string;
  homeDirectory: string;
  now: number;
}

/**
 * Claude Code writes one JSONL per session under
 * `~/.claude/projects/<slug>/`. The newest non-`agent-` file's mtime is the
 * freshness signal; its last entry flags hard failures (`api_error`).
 */
function readClaudeSignal(input: ClaudeSignalInput): Pulse | undefined {
  const { launchDir, homeDirectory, now } = input;
  const projectDir = path.join(
    homeDirectory,
    ".claude",
    "projects",
    claudeProjectSlug(realpathOrSelf(launchDir)),
  );
  const newest = newestFileIn(projectDir, isClaudeSessionFile);
  if (newest === undefined) {
    return undefined;
  }
  const observedAt = new Date(newest.mtimeMs).toISOString();
  if (isClaudeErrorEntry(readLastLine(newest.filePath))) {
    return { state: "blocked", source: "agent-native", observedAt, detail: "agent error" };
  }
  return { state: decayByAge(now - newest.mtimeMs), source: "agent-native", observedAt };
}

function isClaudeSessionFile(fileName: string): boolean {
  return fileName.endsWith(".jsonl") && !fileName.startsWith("agent-");
}

/** Claude records API failures as `{type:"system", subtype:"api_error", level:"error"}`. */
function isClaudeErrorEntry(line: string | undefined): boolean {
  if (line === undefined) {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return false;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- probing untyped JSON fields
  const record = parsed as Record<string, unknown>;
  return (
    record["type"] === "system" && record["subtype"] === "api_error" && record["level"] === "error"
  );
}

interface CodexSignalInput {
  config: ResolvedConfig;
  task: string;
  launchDir: string;
  homeDirectory: string;
  now: number;
}

// Codex shards sessions as `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`,
// and each file's first line records the working directory it ran in.
const CODEX_SCAN_DEPTH_LIMIT = 4;
const CODEX_SCAN_CANDIDATE_LIMIT = 50;

/**
 * Find the codex rollout file whose recorded cwd matches the task's launch
 * dir; its mtime is the freshness signal. The matched path is memoized so
 * steady-state reads cost one stat instead of a directory walk.
 */
function readCodexSignal(input: CodexSignalInput): Pulse | undefined {
  const { config, task, launchDir, homeDirectory, now } = input;
  const realLaunchDir = realpathOrSelf(launchDir);
  const memo = readPulseMemo(config, task);

  const { codexSessionFile: cached } = memo;
  if (cached !== undefined && codexFileMatches(cached, realLaunchDir)) {
    return codexPulse(cached, now);
  }

  const sessionsDir = path.join(homeDirectory, ".codex", "sessions");
  const candidates = collectCodexRolloutFiles(sessionsDir, 0)
    .toSorted((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, CODEX_SCAN_CANDIDATE_LIMIT);
  for (const candidate of candidates) {
    if (codexFileMatches(candidate.filePath, realLaunchDir)) {
      writePulseMemo(config, task, { ...memo, codexSessionFile: candidate.filePath });
      return codexPulse(candidate.filePath, now);
    }
  }
  return undefined;
}

function codexPulse(filePath: string, now: number): Pulse | undefined {
  let mtimeMs: number;
  try {
    ({ mtimeMs } = statSync(filePath));
  } catch {
    /* v8 ignore next @preserve -- only reachable when the file vanishes between the first-line read and this stat */
    return undefined;
  }
  return {
    state: decayByAge(now - mtimeMs),
    source: "agent-native",
    observedAt: new Date(mtimeMs).toISOString(),
  };
}

function codexFileMatches(filePath: string, launchDir: string): boolean {
  const firstLine = readFirstLine(filePath);
  if (firstLine === undefined) {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(firstLine);
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return false;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- probing untyped JSON fields
  const record = parsed as Record<string, unknown>;
  const { payload } = record;
  const cwd =
    typeof payload === "object" && payload !== null
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- probing untyped JSON fields
        (payload as Record<string, unknown>)["cwd"]
      : record["cwd"];
  return cwd === launchDir;
}

interface FileWithMtime {
  filePath: string;
  mtimeMs: number;
}

function collectCodexRolloutFiles(dir: string, depth: number): FileWithMtime[] {
  if (depth > CODEX_SCAN_DEPTH_LIMIT) {
    return [];
  }
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const results: FileWithMtime[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    let stats;
    try {
      // lstat so symlinked directories never create scan cycles.
      stats = lstatSync(fullPath);
    } catch {
      /* v8 ignore next @preserve -- only reachable when the entry vanishes between readdir and this lstat */
      continue;
    }
    if (stats.isDirectory()) {
      results.push(...collectCodexRolloutFiles(fullPath, depth + 1));
    } else if (entry.startsWith("rollout-") && entry.endsWith(".jsonl")) {
      results.push({ filePath: fullPath, mtimeMs: stats.mtimeMs });
    }
  }
  return results;
}

// --- pane-hash fallback -------------------------------------------------------

interface PaneDecayInput {
  config: ResolvedConfig;
  task: string;
  paneText: string;
  now: number;
}

/**
 * Without a native signal, treat "the pane text changed" as activity: hash
 * the capture, memoize hash + change time in the state dir, and decay the
 * state by how long the pane has looked the same.
 */
function decayFromPaneMemo(input: PaneDecayInput): Pulse {
  const { config, task, paneText, now } = input;
  const hash = createHash("sha256").update(paneText).digest("hex");
  const memo = readPulseMemo(config, task);
  const previousChangedAt =
    memo.paneHash === hash ? Date.parse(memo.paneChangedAt ?? "") : Number.NaN;
  const changedAt = Number.isNaN(previousChangedAt) ? now : previousChangedAt;
  if (memo.paneHash !== hash || memo.paneChangedAt === undefined) {
    writePulseMemo(config, task, {
      ...memo,
      paneHash: hash,
      paneChangedAt: new Date(changedAt).toISOString(),
    });
  }
  return {
    state: decayByAge(now - changedAt),
    source: "pane",
    observedAt: new Date(changedAt).toISOString(),
  };
}

// --- per-task memo store ------------------------------------------------------

interface PulseMemo {
  paneHash?: string;
  paneChangedAt?: string;
  codexSessionFile?: string;
}

function pulseMemoPath(config: ResolvedConfig, task: string): string {
  return path.join(pulseDirectory(config), `${task}.json`);
}

function readPulseMemo(config: ResolvedConfig, task: string): PulseMemo {
  let raw: string;
  try {
    raw = readFileSync(pulseMemoPath(config, task), "utf8");
  } catch {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) {
    return {};
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- probing our own JSON memo
  const record = parsed as Record<string, unknown>;
  return {
    ...(typeof record["paneHash"] === "string" ? { paneHash: record["paneHash"] } : {}),
    ...(typeof record["paneChangedAt"] === "string"
      ? { paneChangedAt: record["paneChangedAt"] }
      : {}),
    ...(typeof record["codexSessionFile"] === "string"
      ? { codexSessionFile: record["codexSessionFile"] }
      : {}),
  };
}

function writePulseMemo(config: ResolvedConfig, task: string, memo: PulseMemo): void {
  const memoPath = pulseMemoPath(config, task);
  try {
    mkdirSync(path.dirname(memoPath), { recursive: true });
    const tmpPath = `${memoPath}.${process.pid}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(memo, undefined, 2)}\n`, { mode: 0o600 });
    renameSync(tmpPath, memoPath);
  } catch (error) {
    // Best-effort: a failed memo only weakens decay/caching, never the read.
    debug(`pulse memo write failed for ${task}: ${errorMessage(error)}`);
  }
}

/** Newest matching file in a directory by mtime; undefined when none or unreadable. */
function newestFileIn(
  dir: string,
  include: (fileName: string) => boolean,
): FileWithMtime | undefined {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return undefined;
  }
  let newest: FileWithMtime | undefined;
  for (const entry of entries) {
    if (!include(entry)) {
      continue;
    }
    const filePath = path.join(dir, entry);
    let mtimeMs: number;
    try {
      ({ mtimeMs } = statSync(filePath));
    } catch {
      /* v8 ignore next @preserve -- only reachable when the file vanishes between readdir and this stat */
      continue;
    }
    if (newest === undefined || mtimeMs > newest.mtimeMs) {
      newest = { filePath, mtimeMs };
    }
  }
  return newest;
}

// --- bounded file reads -------------------------------------------------------

const LINE_READ_WINDOW_BYTES = 65_536;

/** Last non-empty line of a file, reading at most the trailing 64 KiB. */
function readLastLine(filePath: string): string | undefined {
  let descriptor: number;
  let size: number;
  try {
    descriptor = openSync(filePath, "r");
  } catch {
    /* v8 ignore next @preserve -- only reachable when the file vanishes after newestFileIn observed it */
    return undefined;
  }
  try {
    ({ size } = statSync(filePath));
    const length = Math.min(size, LINE_READ_WINDOW_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(descriptor, buffer, 0, length, size - length);
    const lines = buffer.toString("utf8").split("\n");
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]?.trim();
      if (line !== undefined && line.length > 0) {
        return line;
      }
    }
    return undefined;
  } catch {
    /* v8 ignore next @preserve -- stat/read on a just-opened descriptor only fails in an unlink race */
    return undefined;
  } finally {
    closeSync(descriptor);
  }
}

/** First line of a file, reading at most the leading 64 KiB. */
function readFirstLine(filePath: string): string | undefined {
  let descriptor: number;
  try {
    descriptor = openSync(filePath, "r");
  } catch {
    return undefined;
  }
  try {
    const buffer = Buffer.alloc(LINE_READ_WINDOW_BYTES);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    const newlineIndex = text.indexOf("\n");
    const line = (newlineIndex === -1 ? text : text.slice(0, newlineIndex)).trim();
    return line.length > 0 ? line : undefined;
  } catch {
    /* v8 ignore next @preserve -- read on a just-opened descriptor only fails in an unlink race */
    return undefined;
  } finally {
    closeSync(descriptor);
  }
}
