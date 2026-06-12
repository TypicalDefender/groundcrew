import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AutopilotConfig, ResolvedConfig } from "../lib/config.ts";
import type { PullRequestSummary, ReviewComment } from "../lib/pullRequests.ts";
import {
  readRunState,
  recordRunState,
  recordTaskAutopilot,
  type RunState,
} from "../lib/runState.ts";
import { captureConsoleLog, type ConsoleCapture } from "../testHelpers/consoleCapture.ts";
import { workspaces } from "../lib/workspaces.ts";
import {
  type AutopilotDeps,
  createAutopilot,
  DEFAULT_AUTOPILOT_DEPS,
  decideFollowUps,
  hasAutopilotCandidates,
  staleMemoClears,
} from "./autopilot.ts";

vi.mock(import("../lib/workspaces.ts"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    workspaces: {
      open: vi.fn<typeof actual.workspaces.open>(),
      probe: vi.fn<typeof actual.workspaces.probe>(),
      close: vi.fn<typeof actual.workspaces.close>(),
      interrupt: vi.fn<typeof actual.workspaces.interrupt>(),
      accessHint: vi.fn<typeof actual.workspaces.accessHint>(),
      capturePane: vi.fn<typeof actual.workspaces.capturePane>(),
      sendText: vi.fn<typeof actual.workspaces.sendText>(),
    },
  };
});

const probeMock = vi.mocked(workspaces.probe);

const NOW = new Date("2026-06-13T08:00:00.000Z");

const ALL_ON: AutopilotConfig = {
  ciFailure: { enabled: true, maxAttempts: 2 },
  reviewComments: { enabled: true },
  autoMerge: { enabled: true },
  stuck: { enabled: true, thresholdMinutes: 10 },
};

const ALL_OFF: AutopilotConfig = {
  ciFailure: { enabled: false, maxAttempts: 2 },
  reviewComments: { enabled: false },
  autoMerge: { enabled: false },
  stuck: { enabled: false, thresholdMinutes: 10 },
};

function makeConfig(stateRoot: string, autopilot: AutopilotConfig): ResolvedConfig {
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
    autopilot,
  };
}

function runState(task: string, overrides: Partial<RunState> = {}): RunState {
  return {
    task,
    repository: "repo-a",
    agent: "claude",
    worktreeDir: `/work/repo-a-${task}`,
    branchName: `dev-${task}`,
    workspaceName: task,
    state: "running",
    createdAt: "2026-06-13T07:00:00.000Z",
    updatedAt: "2026-06-13T07:00:00.000Z",
    resumeCount: 0,
    ...overrides,
  };
}

function decide(
  states: RunState[],
  autopilot: AutopilotConfig,
  liveNames: ReadonlySet<string> = new Set(states.map((state) => state.workspaceName)),
): ReturnType<typeof decideFollowUps> {
  return decideFollowUps({
    runStates: states,
    liveNames,
    config: { autopilot },
    now: NOW,
  });
}

function reviewComment(id: string, body: string): ReviewComment {
  return {
    id,
    threadId: `t-${id}`,
    author: "alice",
    body,
    url: `https://github.com/acme/repo-a/pull/7#discussion_${id}`,
    path: "src/lib/board.ts",
    line: 12,
  };
}

const FAILING_PR = {
  prUrl: "https://github.com/acme/repo-a/pull/7",
  ci: "failing",
} as const;

describe(decideFollowUps, () => {
  it("merges approved+passing PRs when autoMerge is on, even mid-pulse", () => {
    const state = runState("team-1", {
      prUrl: "https://github.com/acme/repo-a/pull/9",
      ci: "passing",
      review: "approved",
      pulse: "active",
    });

    expect(decide([state], ALL_ON)).toStrictEqual([
      {
        kind: "merge",
        task: "team-1",
        prUrl: "https://github.com/acme/repo-a/pull/9",
        branchName: "dev-team-1",
        worktreeDir: "/work/repo-a-team-1",
      },
    ]);
    expect(decide([state], ALL_OFF)).toStrictEqual([]);
  });

  it("nudges failing CI under the attempt budget and stops at maxAttempts", () => {
    const fresh = runState("team-1", FAILING_PR);
    const once = runState("team-1", { ...FAILING_PR, ciNudgeAttempts: 1 });
    const exhausted = runState("team-1", { ...FAILING_PR, ciNudgeAttempts: 2 });

    expect(decide([fresh], ALL_ON)[0]).toMatchObject({ kind: "nudge-ci-failure", attempt: 1 });
    expect(decide([once], ALL_ON)[0]).toMatchObject({ kind: "nudge-ci-failure", attempt: 2 });
    expect(decide([exhausted], ALL_ON)).toStrictEqual([]);
    expect(decide([fresh], ALL_OFF)).toStrictEqual([]);
  });

  it("never nudges or flags a task whose pulse is active or whose workspace is gone", () => {
    const active = runState("team-1", { ...FAILING_PR, pulse: "active" });
    const gone = runState("team-2", FAILING_PR);

    expect(decide([active], ALL_ON)).toStrictEqual([]);
    expect(decide([gone], ALL_ON, new Set<string>())).toStrictEqual([]);
  });

  it("proposes a review nudge for changes-requested, carrying the delivered ids", () => {
    const fresh = runState("team-1", {
      prUrl: "https://github.com/acme/repo-a/pull/7",
      review: "changes-requested",
    });
    const partiallyDelivered = runState("team-1", {
      prUrl: "https://github.com/acme/repo-a/pull/7",
      review: "changes-requested",
      nudgedCommentIds: ["c1"],
    });

    expect(decide([fresh], ALL_ON)[0]).toMatchObject({
      kind: "nudge-review-comments",
      deliveredCommentIds: [],
    });
    // Still proposed — the executor decides whether anything NEW exists.
    expect(decide([partiallyDelivered], ALL_ON)[0]).toMatchObject({
      kind: "nudge-review-comments",
      deliveredCommentIds: ["c1"],
    });
    expect(decide([fresh], ALL_OFF)).toStrictEqual([]);
  });

  it("flags a stale pulse as stuck once, ignoring gone pulses and fresh ones", () => {
    const stale = runState("team-1", {
      pulse: "idle",
      pulseChangedAt: "2026-06-13T07:45:00.000Z",
    });
    const fresh = runState("team-2", {
      pulse: "idle",
      pulseChangedAt: "2026-06-13T07:55:00.000Z",
    });
    const gone = runState("team-3", {
      pulse: "gone",
      pulseChangedAt: "2026-06-13T06:00:00.000Z",
    });
    const flagged = runState("team-4", {
      pulse: "idle",
      pulseChangedAt: "2026-06-13T07:00:00.000Z",
      stuckSince: "2026-06-13T07:30:00.000Z",
    });

    expect(decide([stale, fresh, gone, flagged], ALL_ON)).toStrictEqual([
      { kind: "flag-stuck", task: "team-1", stuckForMinutes: 15 },
    ]);
    expect(decide([stale], ALL_OFF)).toStrictEqual([]);
  });

  it("emits at most one action per task, in merge > ci > review > stuck order", () => {
    const everything = runState("team-1", {
      prUrl: "https://github.com/acme/repo-a/pull/7",
      ci: "failing",
      review: "changes-requested",
      pulse: "idle",
      pulseChangedAt: "2026-06-13T07:00:00.000Z",
    });

    const actions = decide([everything], ALL_ON);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: "nudge-ci-failure" });
  });

  it("does nothing for a task whose autopilot switch is off, even merges", () => {
    const state = runState("team-1", {
      prUrl: "https://github.com/acme/repo-a/pull/9",
      ci: "passing",
      review: "approved",
      autopilotEnabled: false,
    });

    expect(decide([state], ALL_ON)).toStrictEqual([]);
  });

  it("falls back to stuck-only defaults when the config omits autopilot", () => {
    const stale = runState("team-1", {
      pulse: "idle",
      pulseChangedAt: "2026-06-13T07:45:00.000Z",
      ci: "failing",
      prUrl: "https://github.com/acme/repo-a/pull/7",
    });

    const actions = decideFollowUps({
      runStates: [stale],
      liveNames: new Set(["team-1"]),
      config: {},
      now: NOW,
    });

    expect(actions).toStrictEqual([{ kind: "flag-stuck", task: "team-1", stuckForMinutes: 15 }]);
  });
});

describe(hasAutopilotCandidates, () => {
  it("is false for quiet fleets and true when any rule or memo could apply", () => {
    expect(hasAutopilotCandidates([runState("team-1")], { autopilot: ALL_ON })).toBe(false);
    expect(
      hasAutopilotCandidates([runState("team-1", { ci: "failing" })], { autopilot: ALL_ON }),
    ).toBe(true);
    expect(
      hasAutopilotCandidates([runState("team-1", { ci: "failing" })], { autopilot: ALL_OFF }),
    ).toBe(false);
    expect(
      hasAutopilotCandidates([runState("team-1", { ciNudgeAttempts: 1 })], {
        autopilot: ALL_OFF,
      }),
    ).toBe(true);
  });
});

describe(staleMemoClears, () => {
  it("clears each memo exactly when its trigger condition has passed", () => {
    expect(
      staleMemoClears(
        runState("team-1", {
          ciNudgeAttempts: 2,
          ci: "passing",
          reviewNudgedAt: "x",
          nudgedCommentIds: ["c1"],
          review: "approved",
          stuckSince: "x",
          pulse: "active",
        }),
      ),
    ).toStrictEqual(["ciNudgeAttempts", "reviewNudgedAt", "nudgedCommentIds", "stuckSince"]);
    expect(
      staleMemoClears(
        runState("team-1", {
          ciNudgeAttempts: 1,
          ci: "failing",
          reviewNudgedAt: "x",
          nudgedCommentIds: ["c1"],
          review: "changes-requested",
          stuckSince: "x",
          pulse: "idle",
        }),
      ),
    ).toStrictEqual([]);
  });
});

describe(createAutopilot, () => {
  let stateRoot: string;
  let config: ResolvedConfig;
  let consoleLog: ConsoleCapture;
  let sent: { name: string; text: string }[];
  let deps: AutopilotDeps;
  let summaries: PullRequestSummary[];
  let merged: PullRequestSummary[];
  let comments: ReviewComment[];

  beforeEach(() => {
    stateRoot = mkdtempSync(path.join(tmpdir(), "groundcrew-autopilot-"));
    config = makeConfig(stateRoot, ALL_ON);
    consoleLog = captureConsoleLog();
    probeMock.mockResolvedValue({ kind: "ok", names: new Set(["team-1"]) });
    sent = [];
    summaries = [];
    merged = [];
    comments = [];
    deps = {
      sendText: async (_config, name, text) => {
        sent.push({ name, text });
        return { kind: "sent" };
      },
      findPullRequests: async () => summaries,
      merge: async ({ pullRequest }) => {
        merged.push(pullRequest);
        return { outcome: "merged" };
      },
      buildCiFailureNudge: (action) => `fix CI on ${action.prUrl}`,
      fetchComments: async () => comments,
    };
  });

  afterEach(() => {
    consoleLog.restore();
    rmSync(stateRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  function seed(): void {
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
  }

  function statesWith(overrides: Partial<RunState>): RunState[] {
    const onDisk = readRunState(config, "team-1");
    if (onDisk === undefined) {
      throw new Error("expected a seeded run state");
    }
    return [{ ...onDisk, ...overrides }];
  }

  it("persists the CI attempt counter through real run states until exhaustion", async () => {
    seed();
    const autopilot = createAutopilot({ config }, deps);

    await autopilot.runOnce({ runStates: statesWith(FAILING_PR), now: NOW });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toBe("fix CI on https://github.com/acme/repo-a/pull/7");
    expect(readRunState(config, "team-1")?.ciNudgeAttempts).toBe(1);

    await autopilot.runOnce({ runStates: statesWith(FAILING_PR), now: NOW });
    expect(sent).toHaveLength(2);
    expect(readRunState(config, "team-1")?.ciNudgeAttempts).toBe(2);
    expect(readRunState(config, "team-1")?.autopilotActivity).toStrictEqual([
      {
        at: NOW.toISOString(),
        kind: "nudge-ci-failure",
        detail: "nudged about failing CI (attempt 2)",
      },
      {
        at: NOW.toISOString(),
        kind: "nudge-ci-failure",
        detail: "nudged about failing CI (attempt 1)",
      },
    ]);

    await autopilot.runOnce({ runStates: statesWith(FAILING_PR), now: NOW });
    expect(sent).toHaveLength(2);
  });

  it("does not burn an attempt or a memo when the nudge cannot be delivered", async () => {
    seed();
    deps.sendText = async () => ({ kind: "unavailable" });
    const autopilot = createAutopilot({ config }, deps);

    comments = [reviewComment("c1", "use a Map here")];
    await autopilot.runOnce({ runStates: statesWith(FAILING_PR), now: NOW });
    await autopilot.runOnce({
      runStates: statesWith({
        prUrl: "https://github.com/acme/repo-a/pull/7",
        review: "changes-requested",
      }),
      now: NOW,
    });

    expect(readRunState(config, "team-1")?.ciNudgeAttempts).toBeUndefined();
    expect(readRunState(config, "team-1")?.reviewNudgedAt).toBeUndefined();
    expect(readRunState(config, "team-1")?.nudgedCommentIds).toBeUndefined();
    expect(consoleLog.output()).toContain("could not deliver nudge to team-1 (unavailable)");
  });

  it("sets and clears every autopilot memo through the run-state helper", () => {
    seed();
    recordTaskAutopilot({
      config,
      task: "team-1",
      set: {
        ciNudgeAttempts: 1,
        reviewNudgedAt: "x",
        nudgedCommentIds: ["c1"],
        stuckSince: "y",
        autopilotEnabled: false,
      },
    });
    expect(readRunState(config, "team-1")).toMatchObject({
      ciNudgeAttempts: 1,
      reviewNudgedAt: "x",
      nudgedCommentIds: ["c1"],
      stuckSince: "y",
      autopilotEnabled: false,
    });

    recordTaskAutopilot({
      config,
      task: "team-1",
      clear: [
        "ciNudgeAttempts",
        "reviewNudgedAt",
        "nudgedCommentIds",
        "stuckSince",
        "autopilotEnabled",
      ],
    });
    const cleared = readRunState(config, "team-1");
    expect(cleared?.ciNudgeAttempts).toBeUndefined();
    expect(cleared?.reviewNudgedAt).toBeUndefined();
    expect(cleared?.nudgedCommentIds).toBeUndefined();
    expect(cleared?.stuckSince).toBeUndefined();
    expect(cleared?.autopilotEnabled).toBeUndefined();
  });

  it("delivers each review comment exactly once across ticks", async () => {
    seed();
    const autopilot = createAutopilot({ config }, deps);
    const review = {
      prUrl: "https://github.com/acme/repo-a/pull/7",
      review: "changes-requested",
    } as const;
    comments = [reviewComment("c1", "use a Map here")];

    await autopilot.runOnce({
      runStates: statesWith(review),
      now: NOW,
      signal: new AbortController().signal,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain("src/lib/board.ts:12 (alice)");
    expect(sent[0]?.text).toContain("use a Map here");
    expect(readRunState(config, "team-1")?.nudgedCommentIds).toStrictEqual(["c1"]);
    expect(readRunState(config, "team-1")?.reviewNudgedAt).toBe(NOW.toISOString());

    // Same comments next tick: nothing new, nothing sent.
    await autopilot.runOnce({ runStates: statesWith(review), now: NOW });
    expect(sent).toHaveLength(1);

    // A new comment appears: only the new one is delivered.
    comments = [reviewComment("c1", "use a Map here"), reviewComment("c2", "rename this")];
    await autopilot.runOnce({ runStates: statesWith(review), now: NOW });
    expect(sent).toHaveLength(2);
    expect(sent[1]?.text).toContain("rename this");
    expect(sent[1]?.text).not.toContain("use a Map here");
    expect(readRunState(config, "team-1")?.nudgedCommentIds).toStrictEqual(["c1", "c2"]);
  });

  it("merges through the PR seams and reports refusals", async () => {
    seed();
    const summary: PullRequestSummary = {
      url: "https://github.com/acme/repo-a/pull/9",
      number: 9,
      state: "open",
      title: "t",
      headRefOid: "abc",
      ci: "passing",
      review: "approved",
      unresolvedComments: 0,
    };
    summaries = [summary];
    const autopilot = createAutopilot({ config }, deps);
    const mergeable = {
      prUrl: "https://github.com/acme/repo-a/pull/9",
      ci: "passing",
      review: "approved",
    } as const;

    await autopilot.runOnce({ runStates: statesWith(mergeable), now: NOW });
    expect(merged).toStrictEqual([summary]);
    expect(consoleLog.output()).toContain("merged https://github.com/acme/repo-a/pull/9");

    // The fresh lookup disagrees with the recorded state — skip the merge.
    summaries = [{ ...summary, ci: "failing" }];
    await autopilot.runOnce({ runStates: statesWith(mergeable), now: NOW });
    expect(merged).toHaveLength(1);
    expect(consoleLog.output()).toContain("no longer looks mergeable");
  });

  it("flags stuck tasks, clears stale memos, and skips quiet fleets", async () => {
    seed();
    const autopilot = createAutopilot({ config }, deps);
    const stale = {
      pulse: "idle",
      pulseChangedAt: "2026-06-13T07:00:00.000Z",
    } as const;

    await autopilot.runOnce({ runStates: statesWith(stale), now: NOW });
    expect(readRunState(config, "team-1")?.stuckSince).toBe(NOW.toISOString());
    expect(consoleLog.output()).toContain("looks stuck (pulse unchanged for 60m)");

    // Pulse moved again: housekeeping clears the flag on the next tick.
    await autopilot.runOnce({
      runStates: statesWith({ ...stale, pulse: "active", stuckSince: NOW.toISOString() }),
      now: NOW,
    });
    expect(readRunState(config, "team-1")?.stuckSince).toBeUndefined();

    // A fleet with nothing to do never probes the workspaces.
    probeMock.mockClear();
    await autopilot.runOnce({ runStates: statesWith({}), now: NOW });
    expect(probeMock).not.toHaveBeenCalled();
  });

  it("caps the per-task activity trail at ten events", async () => {
    seed();
    recordTaskAutopilot({
      config,
      task: "team-1",
      set: {
        autopilotActivity: Array.from({ length: 10 }, (_, index) => ({
          at: `2026-06-13T0${index % 10}:00:00.000Z`,
          kind: "flag-stuck" as const,
          detail: `old event ${index}`,
        })),
      },
    });
    const autopilot = createAutopilot({ config }, deps);

    await autopilot.runOnce({ runStates: statesWith(FAILING_PR), now: NOW });

    const trail = readRunState(config, "team-1")?.autopilotActivity;
    expect(trail).toHaveLength(10);
    expect(trail?.[0]?.detail).toBe("nudged about failing CI (attempt 1)");
    expect(trail?.at(-1)?.detail).toBe("old event 8");
  });

  it("logs and continues when a follow-up throws", async () => {
    seed();
    deps.sendText = async () => {
      throw new Error("tmux exploded");
    };
    const autopilot = createAutopilot({ config }, deps);

    await autopilot.runOnce({ runStates: statesWith(FAILING_PR), now: NOW });

    expect(consoleLog.output()).toContain(
      "Autopilot: nudge-ci-failure for team-1 failed: tmux exploded",
    );
  });

  it("ships readable default nudge bodies that degrade without CI logs", async () => {
    // stateRoot is a plain temp dir — gh fails fast there, so the default
    // CI builder exercises its no-logs fallback for real.
    await expect(
      DEFAULT_AUTOPILOT_DEPS.buildCiFailureNudge(
        {
          kind: "nudge-ci-failure",
          task: "team-1",
          prUrl: "https://github.com/acme/repo-a/pull/7",
          workspaceName: "team-1",
          worktreeDir: stateRoot,
          branchName: "dev-team-1",
          attempt: 1,
        },
        new AbortController().signal,
      ),
    ).resolves.toContain(
      "CI is failing on your pull request (https://github.com/acme/repo-a/pull/7)",
    );
    // And once without a signal, exercising the other option branch.
    const unsignaled = await DEFAULT_AUTOPILOT_DEPS.buildCiFailureNudge({
      kind: "nudge-ci-failure",
      task: "team-1",
      prUrl: "https://github.com/acme/repo-a/pull/7",
      workspaceName: "team-1",
      worktreeDir: stateRoot,
      branchName: "dev-team-1",
      attempt: 1,
    });
    expect(unsignaled).toContain("CI is failing");
  });

  it("reports a refused merge and ignores bookkeeping for unknown tasks", async () => {
    seed();
    const summary: PullRequestSummary = {
      url: "https://github.com/acme/repo-a/pull/9",
      number: 9,
      state: "open",
      title: "t",
      headRefOid: "abc",
      ci: "passing",
      review: "approved",
      unresolvedComments: 0,
    };
    summaries = [summary];
    deps.merge = async () => ({ outcome: "refused", reason: "branch protections" });
    const autopilot = createAutopilot({ config }, deps);

    await autopilot.runOnce({
      runStates: statesWith({
        prUrl: "https://github.com/acme/repo-a/pull/9",
        ci: "passing",
        review: "approved",
      }),
      now: NOW,
    });

    expect(consoleLog.output()).toContain("merge of https://github.com/acme/repo-a/pull/9 refused");
    expect(
      recordTaskAutopilot({ config, task: "ghost", set: { ciNudgeAttempts: 1 } }),
    ).toBeUndefined();
  });

  it("treats an unavailable probe as no live workspaces", async () => {
    seed();
    probeMock.mockResolvedValue({ kind: "unavailable" });
    const autopilot = createAutopilot({ config }, deps);

    await autopilot.runOnce({ runStates: statesWith(FAILING_PR), now: NOW });

    expect(sent).toStrictEqual([]);
  });
});
