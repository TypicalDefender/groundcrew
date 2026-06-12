import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildSources } from "./buildSources.ts";
import type { ResolvedConfig } from "./config.ts";
import {
  collectFleetSnapshot,
  type FleetBoardFeed,
  type FleetTask,
  joinFleetSnapshot,
  type JoinFleetSnapshotInput,
} from "./fleet.ts";
import { recordRunState, type RunState } from "./runState.ts";
import { canonicalLinearIssue, canonicalShellIssue } from "./testing/canonicalFixtures.ts";
import type { Issue, TaskSource } from "./taskSource.ts";
import { type WorkspaceProbe, workspaces } from "./workspaces.ts";
import { type WorktreeEntry, worktrees } from "./worktrees.ts";

vi.mock(import("./buildSources.ts"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, buildSources: vi.fn<typeof actual.buildSources>() };
});
vi.mock(import("./workspaces.ts"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    workspaces: { ...actual.workspaces, probe: vi.fn<typeof actual.workspaces.probe>() },
  };
});
vi.mock(import("./worktrees.ts"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    worktrees: { ...actual.worktrees, list: vi.fn<typeof actual.worktrees.list>() },
  };
});

const buildSourcesMock = vi.mocked(buildSources);
const probeMock = vi.mocked(workspaces.probe);
const listWorktreesMock = vi.mocked(worktrees.list);

const TIMESTAMP = "2026-06-12T10:00:00.000Z";

function runState(overrides: Partial<RunState> & { task: string }): RunState {
  return {
    repository: "repo-a",
    agent: "claude",
    worktreeDir: `/work/repo-a-${overrides.task}`,
    branchName: `dev-${overrides.task}`,
    workspaceName: overrides.task,
    state: "running",
    createdAt: "2026-06-12T08:00:00.000Z",
    updatedAt: "2026-06-12T09:00:00.000Z",
    resumeCount: 0,
    ...overrides,
  };
}

function worktreeEntry(overrides: Partial<WorktreeEntry> & { task: string }): WorktreeEntry {
  return {
    repository: "repo-a",
    branchName: `dev-${overrides.task}`,
    dir: `/work/repo-a-${overrides.task}`,
    kind: "host",
    ...overrides,
  };
}

function okProbe(names: string[], exitedNames: string[] = []): WorkspaceProbe {
  return exitedNames.length === 0
    ? { kind: "ok", names: new Set(names) }
    : { kind: "ok", names: new Set(names), exitedNames: new Set(exitedNames) };
}

function joinInput(overrides: Partial<JoinFleetSnapshotInput> = {}): JoinFleetSnapshotInput {
  return {
    timestamp: TIMESTAMP,
    board: { kind: "ok", issues: [] },
    runStates: [],
    worktreeEntries: [],
    probe: okProbe([]),
    ...overrides,
  };
}

function okBoard(issues: Issue[]): FleetBoardFeed {
  return { kind: "ok", issues };
}

function taskById(tasks: readonly FleetTask[], id: string): FleetTask {
  const match = tasks.find((task) => task.id === id);
  if (match === undefined) {
    throw new Error(`no fleet task with id ${id}`);
  }
  return match;
}

async function noop(): Promise<void> {
  await Promise.resolve();
}

function fakeSource(issues: readonly Issue[]): TaskSource {
  return {
    name: "linear",
    verify: noop,
    listTasks: async () => [...issues],
    getTask: async () => null,
    fetch: async () => [...issues],
    resolveOne: async (naturalId) => issues.find((issue) => issue.id === naturalId),
    markInProgress: noop,
    markInReview: async () => ({ outcome: "applied" }),
  };
}

describe(joinFleetSnapshot, () => {
  it("joins a board issue with its run state, worktree, and live workspace", () => {
    const issue = canonicalLinearIssue({
      naturalId: "team-1",
      status: "in-progress",
      title: "Fix the flaky probe",
      url: "https://linear.app/team/issue/TEAM-1",
      agent: "codex",
      repository: "repo-a",
      updatedAt: "2026-06-12T09:30:00.000Z",
    });
    const input = joinInput({
      board: okBoard([issue]),
      runStates: [runState({ task: "team-1", agent: "claude", title: "Cached title" })],
      worktreeEntries: [worktreeEntry({ task: "team-1" })],
      probe: okProbe(["team-1"]),
    });

    const actual = joinFleetSnapshot(input);

    expect(actual.timestamp).toBe(TIMESTAMP);
    expect(actual.board).toStrictEqual({ kind: "ok" });
    expect(actual.workspaces).toStrictEqual({ kind: "ok" });
    expect(actual.straySessions).toStrictEqual([]);
    expect(actual.tasks).toHaveLength(1);
    expect(taskById(actual.tasks, "team-1")).toMatchObject({
      id: "team-1",
      status: "in-progress",
      workspace: "live",
      agent: "claude",
      branchName: "dev-team-1",
      worktreeDir: "/work/repo-a-team-1",
      title: "Fix the flaky probe",
      url: "https://linear.app/team/issue/TEAM-1",
      updatedAt: "2026-06-12T09:30:00.000Z",
      issue: { id: "linear:team-1", source: "linear", status: "in-progress" },
      run: { task: "team-1", state: "running" },
      worktrees: [{ repository: "repo-a", branchName: "dev-team-1", dir: "/work/repo-a-team-1" }],
    });
  });

  it("keeps a worktree without a run state (missing-file case)", () => {
    const input = joinInput({
      worktreeEntries: [worktreeEntry({ task: "team-2" })],
      probe: okProbe([]),
    });

    const actual = joinFleetSnapshot(input);

    expect(taskById(actual.tasks, "team-2")).toMatchObject({
      status: undefined,
      issue: undefined,
      run: undefined,
      workspace: "absent",
      branchName: "dev-team-2",
      worktreeDir: "/work/repo-a-team-2",
      agent: undefined,
      title: undefined,
      updatedAt: undefined,
    });
  });

  it("keeps an orphan worktree that no board issue references", () => {
    const issue = canonicalLinearIssue({ naturalId: "team-9" });
    const input = joinInput({
      board: okBoard([issue]),
      worktreeEntries: [worktreeEntry({ task: "old-task" })],
    });

    const actual = joinFleetSnapshot(input);

    expect(actual.tasks.map((task) => task.id)).toStrictEqual(["old-task", "team-9"]);
    expect(taskById(actual.tasks, "old-task").issue).toBeUndefined();
  });

  it("falls back to run-state branch and directory when the worktree is gone", () => {
    const input = joinInput({
      runStates: [runState({ task: "team-3", title: "Cached title", url: "https://run.example" })],
    });

    const actual = joinFleetSnapshot(input);

    expect(taskById(actual.tasks, "team-3")).toMatchObject({
      branchName: "dev-team-3",
      worktreeDir: "/work/repo-a-team-3",
      title: "Cached title",
      url: "https://run.example",
      updatedAt: "2026-06-12T09:00:00.000Z",
      worktrees: [],
    });
  });

  it("prefers worktree branch/dir over the run-state copy", () => {
    const input = joinInput({
      runStates: [runState({ task: "team-4", branchName: "stale", worktreeDir: "/stale" })],
      worktreeEntries: [worktreeEntry({ task: "team-4" })],
    });

    const actual = joinFleetSnapshot(input);

    expect(taskById(actual.tasks, "team-4")).toMatchObject({
      branchName: "dev-team-4",
      worktreeDir: "/work/repo-a-team-4",
    });
  });

  it("builds tasks from local artifacts alone when the board is unavailable", () => {
    const input = joinInput({
      board: { kind: "unavailable", reason: "missing API key" },
      runStates: [runState({ task: "team-5", title: "Cached title" })],
    });

    const actual = joinFleetSnapshot(input);

    expect(actual.board).toStrictEqual({ kind: "unavailable", reason: "missing API key" });
    expect(taskById(actual.tasks, "team-5")).toMatchObject({
      status: undefined,
      title: "Cached title",
    });
  });

  it("marks workspace liveness unknown when the probe is unavailable", () => {
    const input = joinInput({
      worktreeEntries: [worktreeEntry({ task: "team-6" })],
      probe: { kind: "unavailable", error: new Error("tmux not found") },
    });

    const actual = joinFleetSnapshot(input);

    expect(actual.workspaces).toStrictEqual({ kind: "unavailable", reason: "tmux not found" });
    expect(taskById(actual.tasks, "team-6").workspace).toBe("unknown");
    expect(actual.straySessions).toStrictEqual([]);
  });

  it("reports a generic reason when the probe is unavailable without an error", () => {
    const actual = joinFleetSnapshot(joinInput({ probe: { kind: "unavailable" } }));

    expect(actual.workspaces).toStrictEqual({
      kind: "unavailable",
      reason: "workspace probe unavailable",
    });
  });

  it("distinguishes exited sessions from live and absent ones", () => {
    const input = joinInput({
      worktreeEntries: [
        worktreeEntry({ task: "team-live" }),
        worktreeEntry({ task: "team-exited" }),
        worktreeEntry({ task: "team-absent" }),
      ],
      probe: okProbe(["team-live", "team-exited"], ["team-exited"]),
    });

    const actual = joinFleetSnapshot(input);

    expect(taskById(actual.tasks, "team-live").workspace).toBe("live");
    expect(taskById(actual.tasks, "team-exited").workspace).toBe("exited");
    expect(taskById(actual.tasks, "team-absent").workspace).toBe("absent");
  });

  it("lists sessions matching no task as strays, sorted", () => {
    const input = joinInput({
      worktreeEntries: [worktreeEntry({ task: "team-7" })],
      probe: okProbe(["zz-stray", "aa-stray", "team-7"]),
    });

    const actual = joinFleetSnapshot(input);

    expect(actual.straySessions).toStrictEqual(["aa-stray", "zz-stray"]);
  });

  it("splits ambiguous natural ids into canonical-id tasks without claiming local artifacts", () => {
    const linearIssue = canonicalLinearIssue({ naturalId: "team-8", status: "in-progress" });
    const shellIssue = canonicalShellIssue({ naturalId: "team-8", status: "todo" });
    const input = joinInput({
      board: okBoard([linearIssue, shellIssue]),
      runStates: [runState({ task: "team-8" })],
      worktreeEntries: [worktreeEntry({ task: "team-8" })],
      probe: okProbe(["team-8"]),
    });

    const actual = joinFleetSnapshot(input);

    expect(actual.tasks.map((task) => task.id)).toStrictEqual([
      "linear:team-8",
      "shell-test:team-8",
      "team-8",
    ]);
    expect(taskById(actual.tasks, "linear:team-8")).toMatchObject({
      workspace: "unknown",
      run: undefined,
      worktrees: [],
    });
    expect(taskById(actual.tasks, "team-8")).toMatchObject({
      workspace: "live",
      status: undefined,
      run: { task: "team-8" },
    });
    expect(actual.straySessions).toStrictEqual([]);
  });

  it("uses the most recent of run-state and issue timestamps", () => {
    const newerIssue = canonicalLinearIssue({
      naturalId: "team-10",
      updatedAt: "2026-06-12T09:30:00.000Z",
    });
    const olderIssue = canonicalLinearIssue({
      naturalId: "team-11",
      updatedAt: "2026-06-12T08:30:00.000Z",
    });
    const input = joinInput({
      board: okBoard([newerIssue, olderIssue]),
      runStates: [
        runState({ task: "team-10", updatedAt: "2026-06-12T09:00:00.000Z" }),
        runState({ task: "team-11", updatedAt: "2026-06-12T09:00:00.000Z" }),
      ],
    });

    const actual = joinFleetSnapshot(input);

    expect(taskById(actual.tasks, "team-10").updatedAt).toBe("2026-06-12T09:30:00.000Z");
    expect(taskById(actual.tasks, "team-11").updatedAt).toBe("2026-06-12T09:00:00.000Z");
  });

  it("ignores unparseable timestamps when picking the most recent signal", () => {
    const issue = canonicalLinearIssue({ naturalId: "team-12", updatedAt: "not-a-date" });
    const input = joinInput({
      board: okBoard([issue]),
      runStates: [runState({ task: "team-12", updatedAt: "2026-06-12T09:00:00.000Z" })],
    });

    const actual = joinFleetSnapshot(input);

    expect(taskById(actual.tasks, "team-12").updatedAt).toBe("2026-06-12T09:00:00.000Z");
  });

  it("falls back to the issue timestamp when the run-state one is unparseable", () => {
    const issue = canonicalLinearIssue({
      naturalId: "team-13",
      updatedAt: "2026-06-12T07:00:00.000Z",
    });
    const input = joinInput({
      board: okBoard([issue]),
      runStates: [runState({ task: "team-13", updatedAt: "garbage" })],
    });

    const actual = joinFleetSnapshot(input);

    expect(taskById(actual.tasks, "team-13").updatedAt).toBe("2026-06-12T07:00:00.000Z");
  });
});

describe(collectFleetSnapshot, () => {
  let stateRoot: string;
  let config: ResolvedConfig;

  beforeEach(() => {
    stateRoot = mkdtempSync(path.join(tmpdir(), "groundcrew-fleet-"));
    config = {
      sources: [],
      defaults: { hooks: {} },
      git: { remote: "origin", defaultBranch: "main" },
      workspace: {
        projectDir: "/work",
        knownRepositories: ["repo-a"],
        repositories: [{ name: "repo-a" }],
      },
      orchestrator: {
        maximumInProgress: 4,
        pollIntervalMilliseconds: 1000,
        sessionLimitPercentage: 85,
      },
      agents: {
        default: "claude",
        definitions: { claude: { cmd: "claude", color: "#fff" } },
      },
      prompts: { initial: "x" },
      workspaceKind: "auto",
      local: { runner: "auto" },
      deck: { port: 4400 },
      logging: { file: path.join(stateRoot, "groundcrew.log") },
    };
    listWorktreesMock.mockReturnValue([]);
    probeMock.mockResolvedValue(okProbe([]));
  });

  afterEach(() => {
    rmSync(stateRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("collects board issues, run states, worktrees, and the probe into one snapshot", async () => {
    const issue = canonicalLinearIssue({ naturalId: "team-1", status: "in-progress" });
    buildSourcesMock.mockResolvedValue([fakeSource([issue])]);
    listWorktreesMock.mockReturnValue([worktreeEntry({ task: "team-1" })]);
    probeMock.mockResolvedValue(okProbe(["team-1"]));
    recordRunState({
      config,
      state: {
        task: "team-1",
        repository: "repo-a",
        agent: "claude",
        worktreeDir: "/work/repo-a-team-1",
        branchName: "dev-team-1",
        workspaceName: "team-1",
        state: "running",
      },
    });

    const actual = await collectFleetSnapshot({ config });

    expect(actual.board).toStrictEqual({ kind: "ok" });
    expect(actual.tasks).toHaveLength(1);
    expect(taskById(actual.tasks, "team-1")).toMatchObject({
      status: "in-progress",
      workspace: "live",
      run: { task: "team-1", state: "running" },
    });
    expect(Date.parse(actual.timestamp)).not.toBeNaN();
  });

  it("degrades to an unavailable board when source construction fails", async () => {
    buildSourcesMock.mockRejectedValue(new Error("missing API key"));
    listWorktreesMock.mockReturnValue([worktreeEntry({ task: "team-2" })]);

    const actual = await collectFleetSnapshot({ config });

    expect(actual.board).toStrictEqual({ kind: "unavailable", reason: "missing API key" });
    expect(actual.tasks.map((task) => task.id)).toStrictEqual(["team-2"]);
  });
});
