import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ResolvedConfig } from "./config.ts";
import {
  clearLastSession,
  lastSessionPath,
  readLastSession,
  recordLastSession,
  runningSessionTasks,
  selectRestoreTasks,
  type LastSessionTask,
} from "./lastSession.ts";
import type { RunState } from "./runState.ts";

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
    deck: { port: 4400, pollIntervalMilliseconds: 5000 },
    logging: { file: path.join(stateRoot, "groundcrew.log") },
  };
}

function runState(task: string, state: RunState["state"]): RunState {
  return {
    task,
    repository: "repo-a",
    agent: "claude",
    worktreeDir: `/work/repo-a-${task}`,
    branchName: `dev-${task}`,
    workspaceName: task,
    state,
    createdAt: "2026-06-13T00:00:00.000Z",
    updatedAt: "2026-06-13T00:00:00.000Z",
    resumeCount: 0,
  };
}

function sessionTask(task: string): LastSessionTask {
  return { task, repository: "repo-a", agent: "claude", workspaceName: task };
}

describe("last session snapshot", () => {
  let stateRoot: string;
  let config: ResolvedConfig;

  beforeEach(() => {
    stateRoot = mkdtempSync(path.join(tmpdir(), "groundcrew-last-session-"));
    config = makeConfig(stateRoot);
  });

  afterEach(() => {
    rmSync(stateRoot, { recursive: true, force: true });
  });

  it("round-trips the running fleet beside the log file", () => {
    const now = new Date("2026-06-13T08:00:00.000Z");

    const written = recordLastSession({ config, tasks: [sessionTask("team-1")], now });

    expect(lastSessionPath(config)).toBe(path.join(stateRoot, "last-session.json"));
    expect(readLastSession(config)).toStrictEqual(written);
    expect(written.stoppedAt).toBe("2026-06-13T08:00:00.000Z");

    clearLastSession(config);
    expect(readLastSession(config)).toBeUndefined();
    expect(existsSync(lastSessionPath(config))).toBe(false);
  });

  it("treats malformed snapshots as absent", () => {
    writeFileSync(lastSessionPath(config), "not json");
    expect(readLastSession(config)).toBeUndefined();

    writeFileSync(lastSessionPath(config), JSON.stringify({ tasks: [] }));
    expect(readLastSession(config)).toBeUndefined();

    writeFileSync(lastSessionPath(config), JSON.stringify({ stoppedAt: "x", tasks: "none" }));
    expect(readLastSession(config)).toBeUndefined();

    writeFileSync(
      lastSessionPath(config),
      JSON.stringify({ stoppedAt: "x", tasks: [{ task: "team-1" }] }),
    );
    expect(readLastSession(config)).toBeUndefined();

    writeFileSync(lastSessionPath(config), JSON.stringify({ stoppedAt: "x", tasks: [7] }));
    expect(readLastSession(config)).toBeUndefined();
  });
});

describe(runningSessionTasks, () => {
  it("keeps only running and resumed tasks", () => {
    const tasks = runningSessionTasks([
      runState("team-1", "running"),
      runState("team-2", "interrupted"),
      runState("team-3", "resumed"),
      runState("team-4", "failed-to-launch"),
    ]);

    expect(tasks.map((task) => task.task)).toStrictEqual(["team-1", "team-3"]);
    expect(tasks[0]).toStrictEqual(sessionTask("team-1"));
  });
});

describe(selectRestoreTasks, () => {
  const session = {
    stoppedAt: "2026-06-13T08:00:00.000Z",
    tasks: [sessionTask("team-1"), sessionTask("team-2"), sessionTask("team-3")],
  };

  it("resumes gone tasks, leaves live ones, skips cleaned-up ones", () => {
    const selection = selectRestoreTasks({
      session,
      liveNames: new Set(["team-2"]),
      runStates: [runState("team-1", "running"), runState("team-2", "running")],
    });

    expect(selection.resume.map((task) => task.task)).toStrictEqual(["team-1"]);
    expect(selection.stillLive.map((task) => task.task)).toStrictEqual(["team-2"]);
    expect(selection.cleanedUp.map((task) => task.task)).toStrictEqual(["team-3"]);
  });

  it("selects nothing without a snapshot", () => {
    const selection = selectRestoreTasks({
      session: undefined,
      liveNames: new Set(["team-1"]),
      runStates: [runState("team-1", "running")],
    });

    expect(selection).toStrictEqual({ resume: [], stillLive: [], cleanedUp: [] });
  });
});
