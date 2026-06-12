/**
 * Fleet snapshot — the single read model over everything groundcrew knows
 * about its tasks. Joins board issues (remote source of truth), run states
 * (local dispatch lifecycle), worktrees (checkouts on disk), and workspace
 * liveness (terminal sessions) into one typed `FleetSnapshot` so consumers
 * (`crew status`, dashboards, follow-up automation) never re-join the
 * sources themselves.
 *
 * Pure join logic lives in `joinFleetSnapshot`; `collectFleetSnapshot` owns
 * the I/O at the edges (board fetch, run-state reads, worktree listing,
 * workspace probe).
 */

import { createBoard } from "./board.ts";
import { buildSources, sourcesFromConfig } from "./buildSources.ts";
import type { ResolvedConfig } from "./config.ts";
import { listRunStates, type RunState } from "./runState.ts";
import { type CanonicalStatus, type Issue, naturalIdFromCanonical } from "./taskSource.ts";
import { errorMessage } from "./util.ts";
import { type WorkspaceProbe, workspaces } from "./workspaces.ts";
import { type WorktreeEntry, worktrees } from "./worktrees.ts";

/**
 * Liveness of the task's terminal session. `absent` is a confirmed "no
 * session"; `unknown` means the probe was unavailable (or the task id is
 * ambiguous across sources, so no session can be attributed to it).
 */
export type FleetWorkspaceLiveness = "live" | "exited" | "absent" | "unknown";

export interface FleetWorktree {
  repository: string;
  branchName: string;
  dir: string;
}

/** Display-oriented slice of a board issue carried on a fleet task. */
export interface FleetIssue {
  /** Canonical source-prefixed id, e.g. "linear:team-220". */
  id: string;
  source: string;
  title: string;
  status: CanonicalStatus;
  assignee: string;
  updatedAt: string;
  repository: string | undefined;
  agent: string | undefined;
  url: string | undefined;
}

export interface FleetTask {
  /**
   * Join key. The lowercased natural id (matches `WorktreeEntry.task`,
   * `RunState.task`, and workspace names); the canonical source-prefixed id
   * when the natural id is ambiguous across sources and local artifacts
   * can't be attributed to one issue.
   */
  id: string;
  /** Remote canonical status; undefined when the board has no match for this task. */
  status: CanonicalStatus | undefined;
  issue: FleetIssue | undefined;
  run: RunState | undefined;
  worktrees: readonly FleetWorktree[];
  workspace: FleetWorkspaceLiveness;
  /** Run-state agent when dispatched; otherwise the agent parsed from the issue. */
  agent: string | undefined;
  /** The agent's configured badge color, when the agent has a definition. */
  agentColor: string | undefined;
  branchName: string | undefined;
  worktreeDir: string | undefined;
  title: string | undefined;
  url: string | undefined;
  /** Most recent signal across the run state and the board issue. */
  updatedAt: string | undefined;
}

export type FleetFeedHealth = { kind: "ok" } | { kind: "unavailable"; reason: string };

export interface FleetSnapshot {
  timestamp: string;
  tasks: readonly FleetTask[];
  /** Workspace sessions whose name matches no fleet task. */
  straySessions: readonly string[];
  board: FleetFeedHealth;
  workspaces: FleetFeedHealth;
}

export type FleetBoardFeed =
  | { kind: "ok"; issues: readonly Issue[] }
  | { kind: "unavailable"; reason: string };

export interface CollectFleetSnapshotInput {
  config: ResolvedConfig;
  signal?: AbortSignal;
}

export async function collectFleetSnapshot(
  input: CollectFleetSnapshotInput,
): Promise<FleetSnapshot> {
  const { config, signal } = input;
  const [board, probe] = await Promise.all([
    fetchBoardFeed(config),
    workspaces.probe(config, signal),
  ]);
  return joinFleetSnapshot({
    timestamp: new Date().toISOString(),
    board,
    runStates: listRunStates(config),
    worktreeEntries: worktrees.list(config),
    probe,
    agentColors: Object.fromEntries(
      Object.entries(config.agents.definitions).map(([name, definition]) => [
        name,
        definition.color,
      ]),
    ),
  });
}

export interface JoinFleetSnapshotInput {
  timestamp: string;
  board: FleetBoardFeed;
  runStates: readonly RunState[];
  worktreeEntries: readonly WorktreeEntry[];
  probe: WorkspaceProbe;
  /** Agent name → badge color, from the crew config's agent definitions. */
  agentColors?: Readonly<Record<string, string>>;
}

/**
 * Pure join. Tasks are the union of board issues and local artifacts (run
 * states, worktrees), keyed by lowercased natural id. When two sources emit
 * the same natural id, each issue becomes its own canonical-id task and the
 * local artifacts stay on a separate local-only task — guessing an owner
 * would attribute branches and sessions to the wrong issue.
 */
export function joinFleetSnapshot(input: JoinFleetSnapshotInput): FleetSnapshot {
  const { timestamp, board, runStates, worktreeEntries, probe } = input;
  const agentColors = input.agentColors ?? {};
  const localByTask = collectLocalArtifacts(runStates, worktreeEntries);
  const issuesByNaturalId = groupIssuesByNaturalId(board);

  const tasks: FleetTask[] = [];
  const sessionOwners = new Set<string>();
  for (const [naturalId, issues] of issuesByNaturalId) {
    sessionOwners.add(naturalId);
    if (issues.length === 1) {
      tasks.push(
        buildFleetTask({
          id: naturalId,
          // oxlint-disable-next-line typescript/no-non-null-assertion -- length checked above
          issue: issues[0]!,
          local: localByTask.get(naturalId),
          liveness: sessionLiveness(probe, naturalId),
          agentColors,
        }),
      );
      localByTask.delete(naturalId);
      continue;
    }
    for (const issue of issues) {
      tasks.push(
        buildFleetTask({ id: issue.id, issue, local: undefined, liveness: "unknown", agentColors }),
      );
    }
  }
  for (const [taskId, local] of localByTask) {
    sessionOwners.add(taskId);
    tasks.push(
      buildFleetTask({
        id: taskId,
        issue: undefined,
        local,
        liveness: sessionLiveness(probe, taskId),
        agentColors,
      }),
    );
  }

  return {
    timestamp,
    tasks: tasks.toSorted((left, right) => left.id.localeCompare(right.id)),
    straySessions: straySessionNames(probe, sessionOwners),
    board: board.kind === "ok" ? { kind: "ok" } : { kind: "unavailable", reason: board.reason },
    workspaces: probeHealth(probe),
  };
}

async function fetchBoardFeed(config: ResolvedConfig): Promise<FleetBoardFeed> {
  try {
    const sources = await buildSources(sourcesFromConfig(config), { globalConfig: config });
    const { issues } = await createBoard(sources).fetch();
    return { kind: "ok", issues };
  } catch (error) {
    return { kind: "unavailable", reason: errorMessage(error) };
  }
}

interface LocalArtifacts {
  run: RunState | undefined;
  worktrees: FleetWorktree[];
}

function collectLocalArtifacts(
  runStates: readonly RunState[],
  worktreeEntries: readonly WorktreeEntry[],
): Map<string, LocalArtifacts> {
  const byTask = new Map<string, LocalArtifacts>();
  function entryFor(task: string): LocalArtifacts {
    const existing = byTask.get(task);
    if (existing !== undefined) {
      return existing;
    }
    const created: LocalArtifacts = { run: undefined, worktrees: [] };
    byTask.set(task, created);
    return created;
  }
  for (const state of runStates) {
    entryFor(state.task).run = state;
  }
  for (const worktree of worktreeEntries) {
    entryFor(worktree.task).worktrees.push({
      repository: worktree.repository,
      branchName: worktree.branchName,
      dir: worktree.dir,
    });
  }
  return byTask;
}

function groupIssuesByNaturalId(board: FleetBoardFeed): Map<string, Issue[]> {
  const byNaturalId = new Map<string, Issue[]>();
  if (board.kind !== "ok") {
    return byNaturalId;
  }
  for (const issue of board.issues) {
    const naturalId = naturalIdFromCanonical(issue.id).toLowerCase();
    const group = byNaturalId.get(naturalId);
    if (group === undefined) {
      byNaturalId.set(naturalId, [issue]);
    } else {
      group.push(issue);
    }
  }
  return byNaturalId;
}

function buildFleetTask(input: {
  id: string;
  issue: Issue | undefined;
  local: LocalArtifacts | undefined;
  liveness: FleetWorkspaceLiveness;
  agentColors: Readonly<Record<string, string>>;
}): FleetTask {
  const { id, issue, local, liveness, agentColors } = input;
  const run = local?.run;
  const taskWorktrees = local?.worktrees ?? [];
  const agent = run?.agent ?? issue?.agent;
  return {
    id,
    status: issue?.status,
    issue: issue === undefined ? undefined : toFleetIssue(issue),
    run,
    worktrees: taskWorktrees,
    workspace: liveness,
    agent,
    agentColor: agent === undefined ? undefined : agentColors[agent],
    ...checkoutFields(taskWorktrees, run),
    ...displayFields(issue, run),
    updatedAt: latestTimestamp(run?.updatedAt, issue?.updatedAt),
  };
}

/** Branch and directory come from the live worktree; the run state keeps a copy for when it's gone. */
function checkoutFields(
  taskWorktrees: readonly FleetWorktree[],
  run: RunState | undefined,
): Pick<FleetTask, "branchName" | "worktreeDir"> {
  const [first] = taskWorktrees;
  return {
    branchName: first?.branchName ?? run?.branchName,
    worktreeDir: first?.dir ?? run?.worktreeDir,
  };
}

/**
 * The issue title/url are the source's current truth; the run state's copies
 * are dispatch-time caches for when the board is unreachable.
 */
function displayFields(
  issue: Issue | undefined,
  run: RunState | undefined,
): Pick<FleetTask, "title" | "url"> {
  return {
    title: issue?.title ?? run?.title,
    url: issue?.url ?? run?.url,
  };
}

function toFleetIssue(issue: Issue): FleetIssue {
  return {
    id: issue.id,
    source: issue.source,
    title: issue.title,
    status: issue.status,
    assignee: issue.assignee,
    updatedAt: issue.updatedAt,
    repository: issue.repository,
    agent: issue.agent,
    url: issue.url,
  };
}

function sessionLiveness(probe: WorkspaceProbe, name: string): FleetWorkspaceLiveness {
  if (probe.kind === "unavailable") {
    return "unknown";
  }
  if (probe.exitedNames?.has(name) === true) {
    return "exited";
  }
  return probe.names.has(name) ? "live" : "absent";
}

function straySessionNames(probe: WorkspaceProbe, owners: ReadonlySet<string>): string[] {
  if (probe.kind === "unavailable") {
    return [];
  }
  return [...probe.names].filter((name) => !owners.has(name)).toSorted();
}

function probeHealth(probe: WorkspaceProbe): FleetFeedHealth {
  if (probe.kind === "ok") {
    return { kind: "ok" };
  }
  return {
    kind: "unavailable",
    reason: probe.error === undefined ? "workspace probe unavailable" : errorMessage(probe.error),
  };
}

function latestTimestamp(left: string | undefined, right: string | undefined): string | undefined {
  const leftMs = left === undefined ? Number.NaN : Date.parse(left);
  const rightMs = right === undefined ? Number.NaN : Date.parse(right);
  if (Number.isNaN(leftMs)) {
    return Number.isNaN(rightMs) ? undefined : right;
  }
  if (Number.isNaN(rightMs)) {
    return left;
  }
  return rightMs > leftMs ? right : left;
}
