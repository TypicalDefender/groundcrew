import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ResolvedConfig } from "./config.ts";
import {
  listRunStates,
  readRunState,
  recordRunState,
  recordTaskPulse,
  recordTaskPullRequest,
  removeRunState,
  type RunLifecycleState,
  runStateDirectory,
  runStatePath,
  updateRunState,
} from "./runState.ts";

function makeConfig(stateRoot: string): ResolvedConfig {
  return {
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
    logging: { file: path.join(stateRoot, "groundcrew.log") },
  };
}

describe("run state store", () => {
  let stateRoot: string;
  let config: ResolvedConfig;

  beforeEach(() => {
    stateRoot = mkdtempSync(path.join(tmpdir(), "groundcrew-run-state-"));
    config = makeConfig(stateRoot);
  });

  afterEach(() => {
    rmSync(stateRoot, { recursive: true, force: true });
  });

  it("stores one JSON file per task next to the configured log file", () => {
    const actual = recordRunState({
      config,
      state: {
        task: "TEAM-1",
        repository: "repo-a",
        agent: "claude",
        worktreeDir: "/work/repo-a-team-1",
        branchName: "dev-team-1",
        workspaceName: "team-1",
        state: "running",
      },
    });

    expect(runStateDirectory(config)).toBe(path.join(stateRoot, "runs"));
    expect(runStatePath(config, "team-1")).toBe(path.join(stateRoot, "runs", "team-1.json"));
    expect(actual.task).toBe("team-1");
    expect(readRunState(config, "TEAM-1")).toMatchObject({
      task: "team-1",
      repository: "repo-a",
      agent: "claude",
      state: "running",
      resumeCount: 0,
    });
  });

  it("stores optional reason, detail, and explicit resume count", () => {
    const actual = recordRunState({
      config,
      state: {
        task: "team-1",
        repository: "repo-a",
        agent: "claude",
        worktreeDir: "/work/repo-a-team-1",
        branchName: "dev-team-1",
        workspaceName: "team-1",
        state: "interrupted",
        reason: "pause",
        detail: "workspace missing",
        resumeCount: 3,
      },
    });

    expect(actual).toMatchObject({
      reason: "pause",
      detail: "workspace missing",
      resumeCount: 3,
    });
    expect(readRunState(config, "team-1")).toMatchObject({
      reason: "pause",
      detail: "workspace missing",
      resumeCount: 3,
    });
  });

  it("round-trips an optional task title", () => {
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
        title: "Improve crew status command output",
      },
    });

    expect(readRunState(config, "team-1")).toMatchObject({
      title: "Improve crew status command output",
    });
  });

  it("preserves a previously-recorded title when a later recordRunState omits it", () => {
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
        title: "Improve crew status command output",
      },
    });

    // resume/interrupt callers don't carry the title; the title should
    // survive on disk so `crew status` can still surface it.
    recordRunState({
      config,
      state: {
        task: "team-1",
        repository: "repo-a",
        agent: "claude",
        worktreeDir: "/work/repo-a-team-1",
        branchName: "dev-team-1",
        workspaceName: "team-1",
        state: "interrupted",
        reason: "manual pause",
      },
    });

    expect(readRunState(config, "team-1")).toMatchObject({
      state: "interrupted",
      title: "Improve crew status command output",
    });
  });

  it("round-trips an optional task url and preserves it across transitions", () => {
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
        url: "https://linear.app/example/issue/TEAM-1",
      },
    });

    expect(readRunState(config, "team-1")).toMatchObject({
      url: "https://linear.app/example/issue/TEAM-1",
    });

    // Subsequent transition omits url — must be preserved.
    recordRunState({
      config,
      state: {
        task: "team-1",
        repository: "repo-a",
        agent: "claude",
        worktreeDir: "/work/repo-a-team-1",
        branchName: "dev-team-1",
        workspaceName: "team-1",
        state: "interrupted",
      },
    });

    expect(readRunState(config, "team-1")).toMatchObject({
      state: "interrupted",
      url: "https://linear.app/example/issue/TEAM-1",
    });
  });

  it("round-trips the canonical completion task id and preserves it across transitions", () => {
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
        completionTaskId: "linear:team-1",
      },
    });

    expect(readRunState(config, "team-1")).toMatchObject({
      completionTaskId: "linear:team-1",
    });

    recordRunState({
      config,
      state: {
        task: "team-1",
        repository: "repo-a",
        agent: "claude",
        worktreeDir: "/work/repo-a-team-1",
        branchName: "dev-team-1",
        workspaceName: "team-1",
        state: "interrupted",
      },
    });

    expect(readRunState(config, "team-1")).toMatchObject({
      state: "interrupted",
      completionTaskId: "linear:team-1",
    });
  });

  it("prefers a freshly provided title over the previously-recorded one", () => {
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
        title: "Old title",
      },
    });

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
        title: "New title",
      },
    });

    expect(readRunState(config, "team-1")).toMatchObject({ title: "New title" });
  });

  it("round-trips every lifecycle state", () => {
    const states: RunLifecycleState[] = ["running", "interrupted", "resumed", "failed-to-launch"];

    for (const state of states) {
      recordRunState({
        config,
        state: {
          task: "team-1",
          repository: "repo-a",
          agent: "claude",
          worktreeDir: "/work/repo-a-team-1",
          branchName: "dev-team-1",
          workspaceName: "team-1",
          state,
        },
      });
      expect(readRunState(config, "team-1")?.state).toBe(state);
    }
  });

  it("updates existing state while preserving createdAt", () => {
    const first = recordRunState({
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

    const updated = updateRunState({
      config,
      task: "team-1",
      patch: {
        state: "interrupted",
        reason: "wrong direction",
      },
    });

    expect(updated).toMatchObject({ state: "interrupted", reason: "wrong direction" });
    expect(updated?.createdAt).toBe(first.createdAt);
  });

  it("returns undefined when updating missing state", () => {
    expect(
      updateRunState({
        config,
        task: "team-1",
        patch: {
          state: "interrupted",
          reason: "wrong direction",
        },
      }),
    ).toBeUndefined();
  });

  it("returns undefined for missing or malformed state files", () => {
    expect(readRunState(config, "team-1")).toBeUndefined();
    mkdirSync(path.dirname(runStatePath(config, "team-1")), { recursive: true });
    writeFileSync(runStatePath(config, "team-1"), "{not json");

    expect(readRunState(config, "team-1")).toBeUndefined();
  });

  it("returns undefined for JSON that is not a valid run state object", () => {
    mkdirSync(path.dirname(runStatePath(config, "team-1")), { recursive: true });
    writeFileSync(runStatePath(config, "team-1"), "null");
    expect(readRunState(config, "team-1")).toBeUndefined();

    writeFileSync(runStatePath(config, "team-1"), JSON.stringify({ task: "team-1" }));
    expect(readRunState(config, "team-1")).toBeUndefined();
  });

  it("reads the legacy `model` field when `agent` is absent", () => {
    mkdirSync(path.dirname(runStatePath(config, "team-1")), { recursive: true });
    writeFileSync(
      runStatePath(config, "team-1"),
      JSON.stringify({
        task: "team-1",
        repository: "repo-a",
        model: "claude",
        worktreeDir: "/work/repo-a-team-1",
        branchName: "dev-team-1",
        workspaceName: "team-1",
        state: "running",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        resumeCount: 0,
      }),
    );
    expect(readRunState(config, "team-1")).toMatchObject({ agent: "claude" });
  });

  it("accepts multi-segment source task ids", () => {
    expect(runStatePath(config, "gc-20260608-001")).toBe(
      path.join(stateRoot, "runs", "gc-20260608-001.json"),
    );
  });

  it("rejects task ids that are not plain source task ids", () => {
    expect(() => runStatePath(config, "../team-1")).toThrow(/plain task id/);
  });

  it("removes a run state file", () => {
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

    removeRunState(config, "team-1");

    expect(readRunState(config, "team-1")).toBeUndefined();
  });

  it("writes readable JSON", () => {
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

    expect(JSON.parse(readFileSync(runStatePath(config, "team-1"), "utf8"))).toMatchObject({
      task: "team-1",
      state: "running",
    });
  });

  it("lists no run states when the directory does not exist", () => {
    expect(listRunStates(config)).toStrictEqual([]);
  });

  it("lists every parseable run state sorted by task id", () => {
    for (const task of ["team-2", "team-1"]) {
      recordRunState({
        config,
        state: {
          task,
          repository: "repo-a",
          agent: "claude",
          worktreeDir: `/work/repo-a-${task}`,
          branchName: `dev-${task}`,
          workspaceName: task,
          state: "running",
        },
      });
    }

    const actual = listRunStates(config);

    expect(actual.map((state) => state.task)).toStrictEqual(["team-1", "team-2"]);
  });

  it("skips non-state files and unparseable records when listing", () => {
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
    const directory = runStateDirectory(config);
    writeFileSync(path.join(directory, "team-2.json"), "not json");
    writeFileSync(path.join(directory, "Team Notes.json"), "{}");
    writeFileSync(path.join(directory, "readme.txt"), "ignore me");

    const actual = listRunStates(config);

    expect(actual.map((state) => state.task)).toStrictEqual(["team-1"]);
  });

  it("records a pulse with its transition timestamp and preserves it across lifecycle writes", () => {
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
    const before = readRunState(config, "team-1");

    const pulsed = recordTaskPulse({
      config,
      task: "team-1",
      pulse: "active",
      observedAt: "2026-06-12T10:00:00.000Z",
    });

    expect(pulsed).toMatchObject({
      pulse: "active",
      pulseChangedAt: "2026-06-12T10:00:00.000Z",
    });
    // Pulse observations must not masquerade as lifecycle transitions.
    expect(pulsed?.updatedAt).toBe(before?.updatedAt);

    // Same pulse later: the transition timestamp stays put.
    const samePulse = recordTaskPulse({
      config,
      task: "team-1",
      pulse: "active",
      observedAt: "2026-06-12T10:05:00.000Z",
    });
    expect(samePulse?.pulseChangedAt).toBe("2026-06-12T10:00:00.000Z");

    // A different pulse moves it.
    const changed = recordTaskPulse({
      config,
      task: "team-1",
      pulse: "idle",
      observedAt: "2026-06-12T10:10:00.000Z",
    });
    expect(changed?.pulseChangedAt).toBe("2026-06-12T10:10:00.000Z");

    // Lifecycle transitions keep the recorded pulse.
    recordRunState({
      config,
      state: {
        task: "team-1",
        repository: "repo-a",
        agent: "claude",
        worktreeDir: "/work/repo-a-team-1",
        branchName: "dev-team-1",
        workspaceName: "team-1",
        state: "interrupted",
      },
    });
    expect(readRunState(config, "team-1")).toMatchObject({
      state: "interrupted",
      pulse: "idle",
      pulseChangedAt: "2026-06-12T10:10:00.000Z",
    });
  });

  it("defaults the pulse transition timestamp to now", () => {
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

    const pulsed = recordTaskPulse({ config, task: "team-1", pulse: "ready" });

    expect(pulsed).toMatchObject({ pulse: "ready" });
    expect(pulsed?.pulseChangedAt).toBeTypeOf("string");
  });

  it("ignores pulse recording for tasks with no run state", () => {
    expect(recordTaskPulse({ config, task: "ghost", pulse: "active" })).toBeUndefined();
  });

  it("drops an unrecognized stored pulse value instead of rejecting the record", () => {
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
    const statePath = runStatePath(config, "team-1");
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- mutating our own freshly-written fixture JSON
    const raw = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
    raw["pulse"] = "vibrating";
    raw["pulseChangedAt"] = "2026-06-12T10:00:00.000Z";
    writeFileSync(statePath, JSON.stringify(raw));

    const actual = readRunState(config, "team-1");

    expect(actual?.pulse).toBeUndefined();
    expect(actual?.pulseChangedAt).toBe("2026-06-12T10:00:00.000Z");
  });

  it("stamps a transition time when a stored pulse lacks one", () => {
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
    const statePath = runStatePath(config, "team-1");
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- mutating our own freshly-written fixture JSON
    const raw = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
    raw["pulse"] = "ready";
    writeFileSync(statePath, JSON.stringify(raw));

    const pulsed = recordTaskPulse({
      config,
      task: "team-1",
      pulse: "ready",
      observedAt: "2026-06-12T11:00:00.000Z",
    });

    expect(pulsed).toMatchObject({
      pulse: "ready",
      pulseChangedAt: "2026-06-12T11:00:00.000Z",
    });
  });

  it("records PR observations and preserves them across lifecycle writes", () => {
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
    const before = readRunState(config, "team-1");

    const recorded = recordTaskPullRequest({
      config,
      task: "team-1",
      prUrl: "https://github.com/x/y/pull/12",
      prNumber: 12,
      ci: "failing",
      review: "changes-requested",
    });

    expect(recorded).toMatchObject({
      prUrl: "https://github.com/x/y/pull/12",
      prNumber: 12,
      ci: "failing",
      review: "changes-requested",
    });
    expect(recorded?.updatedAt).toBe(before?.updatedAt);

    recordRunState({
      config,
      state: {
        task: "team-1",
        repository: "repo-a",
        agent: "claude",
        worktreeDir: "/work/repo-a-team-1",
        branchName: "dev-team-1",
        workspaceName: "team-1",
        state: "interrupted",
      },
    });

    expect(readRunState(config, "team-1")).toMatchObject({
      state: "interrupted",
      prUrl: "https://github.com/x/y/pull/12",
      prNumber: 12,
      ci: "failing",
      review: "changes-requested",
    });
  });

  it("ignores PR recording for tasks with no run state", () => {
    expect(
      recordTaskPullRequest({
        config,
        task: "ghost",
        prUrl: "https://x",
        prNumber: 1,
        ci: "passing",
        review: "approved",
      }),
    ).toBeUndefined();
  });

  it("drops unrecognized stored ci/review/prNumber values instead of rejecting the record", () => {
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
    const statePath = runStatePath(config, "team-1");
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- mutating our own freshly-written fixture JSON
    const raw = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
    raw["ci"] = "on-fire";
    raw["review"] = "vetoed";
    raw["prNumber"] = -3;
    raw["prUrl"] = "https://github.com/x/y/pull/3";
    writeFileSync(statePath, JSON.stringify(raw));

    const actual = readRunState(config, "team-1");

    expect(actual?.ci).toBeUndefined();
    expect(actual?.review).toBeUndefined();
    expect(actual?.prNumber).toBeUndefined();
    expect(actual?.prUrl).toBe("https://github.com/x/y/pull/3");
  });
});
