import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { createAutopilot, type AutopilotDeps } from "../commands/autopilot.ts";
import { captureConsoleLog, type ConsoleCapture } from "../testHelpers/consoleCapture.ts";
import type { ResolvedConfig } from "./config.ts";
import { emitCrewEvent, initializeCrewEvents, resetCrewEventsForTesting } from "./crewEventBus.ts";
import { recordRunState, recordTaskPullRequest, recordTaskPulse } from "./runState.ts";
import { workspaces } from "./workspaces.ts";

vi.mock(import("./workspaces.ts"), async (importOriginal) => {
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

interface ReceivedEvent {
  kind: string;
  title: string;
  priority: string;
}

/** Real local HTTP sink — the Phase 7 webhook fixture. */
async function startSink(): Promise<{ url: string; received: ReceivedEvent[]; stop: () => void }> {
  const received: ReceivedEvent[] = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the sink records our own JSON payloads
      received.push(JSON.parse(body) as ReceivedEvent);
      response.writeHead(204);
      response.end();
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- listen() resolved, so address() is an AddressInfo
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/hook`,
    received,
    stop: () => {
      server.close();
    },
  };
}

function makeConfig(stateRoot: string, sinkUrl: string): ResolvedConfig {
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
    autopilot: {
      ciFailure: { enabled: true, maxAttempts: 1 },
      reviewComments: { enabled: false },
      autoMerge: { enabled: false },
      stuck: { enabled: true, thresholdMinutes: 10 },
    },
    notifiers: [{ kind: "webhook", url: sinkUrl }],
  };
}

function seed(config: ResolvedConfig, task: string): void {
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

describe("crew event bus", () => {
  let stateRoot: string;
  let sink: Awaited<ReturnType<typeof startSink>>;
  let config: ResolvedConfig;
  let consoleLog: ConsoleCapture;

  beforeEach(async () => {
    stateRoot = mkdtempSync(path.join(tmpdir(), "groundcrew-events-"));
    sink = await startSink();
    config = makeConfig(stateRoot, sink.url);
    consoleLog = captureConsoleLog();
  });

  afterEach(() => {
    consoleLog.restore();
    resetCrewEventsForTesting();
    sink.stop();
    rmSync(stateRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("emits into the void until initialized, then delivers through the webhook", async () => {
    await emitCrewEvent({ kind: "crew-woken", title: "early", body: "ignored" });
    expect(sink.received).toStrictEqual([]);

    await initializeCrewEvents(config);
    const event = await emitCrewEvent({
      kind: "crew-paused",
      title: "Crew paused",
      body: "Lunch.",
    });

    expect(event.priority).toBe("info");
    expect(sink.received).toStrictEqual([
      expect.objectContaining({ kind: "crew-paused", title: "Crew paused", priority: "info" }),
    ]);
  });

  it("honors the routing table and survives invalid notifier configs", async () => {
    await initializeCrewEvents({ ...config, notifications: { urgent: ["webhook"] } });
    await emitCrewEvent({ kind: "task-done", title: "done", body: "info goes nowhere" });
    await emitCrewEvent({ kind: "task-stuck", title: "stuck", body: "urgent gets through" });
    expect(sink.received.map((event) => event.kind)).toStrictEqual(["task-stuck"]);

    await initializeCrewEvents({ ...config, notifiers: [{ kind: "pager" }] });
    await emitCrewEvent({ kind: "task-stuck", title: "lost", body: "sink disabled" });
    expect(sink.received).toHaveLength(1);
    expect(consoleLog.output()).toContain("Notifications disabled");

    await initializeCrewEvents({ ...config, notifiers: [] });
    await emitCrewEvent({ kind: "task-stuck", title: "lost", body: "no sinks configured" });
    expect(sink.received).toHaveLength(1);
  });

  it("notifies awaiting-input and pr-mergeable exactly once per transition", async () => {
    await initializeCrewEvents(config);
    seed(config, "team-1");

    recordTaskPulse({ config, task: "team-1", pulse: "awaiting-input" });
    recordTaskPulse({ config, task: "team-1", pulse: "awaiting-input" });
    await vi.waitFor(() => {
      expect(sink.received.filter((event) => event.kind === "awaiting-input")).toHaveLength(1);
    });

    const pullRequest = {
      config,
      task: "team-1",
      prUrl: "https://github.com/acme/repo-a/pull/7",
      prNumber: 7,
    } as const;
    recordTaskPullRequest({ ...pullRequest, ci: "passing", review: "pending" });
    recordTaskPullRequest({ ...pullRequest, ci: "passing", review: "approved" });
    recordTaskPullRequest({ ...pullRequest, ci: "passing", review: "approved" });
    await vi.waitFor(() => {
      expect(sink.received.filter((event) => event.kind === "pr-mergeable")).toHaveLength(1);
    });
  });

  it("emits task-stuck and autopilot-exhausted from real autopilot runs", async () => {
    await initializeCrewEvents(config);
    seed(config, "team-1");
    probeMock.mockResolvedValue({ kind: "ok", names: new Set(["team-1"]) });
    const deps: AutopilotDeps = {
      sendText: async () => ({ kind: "sent" }),
      findPullRequests: async () => [],
      merge: async () => ({ outcome: "merged" }),
      buildCiFailureNudge: () => "fix it",
      fetchComments: async () => [],
    };
    const autopilot = createAutopilot({ config }, deps);
    const NOW = new Date("2026-06-13T08:00:00.000Z");

    // maxAttempts is 1, so the first nudge exhausts the budget.
    await autopilot.runOnce({
      runStates: [
        {
          task: "team-1",
          repository: "repo-a",
          agent: "claude",
          worktreeDir: "/work/repo-a-team-1",
          branchName: "dev-team-1",
          workspaceName: "team-1",
          state: "running",
          createdAt: "2026-06-13T07:00:00.000Z",
          updatedAt: "2026-06-13T07:00:00.000Z",
          resumeCount: 0,
          prUrl: "https://github.com/acme/repo-a/pull/7",
          ci: "failing",
        },
        {
          task: "team-1",
          repository: "repo-a",
          agent: "claude",
          worktreeDir: "/work/repo-a-team-1",
          branchName: "dev-team-1",
          workspaceName: "team-1",
          state: "running",
          createdAt: "2026-06-13T07:00:00.000Z",
          updatedAt: "2026-06-13T07:00:00.000Z",
          resumeCount: 0,
          pulse: "idle",
          pulseChangedAt: "2026-06-13T07:00:00.000Z",
        },
      ],
      now: NOW,
    });

    const kinds = sink.received.map((event) => event.kind).toSorted();
    expect(kinds).toStrictEqual(["autopilot-exhausted", "task-stuck"]);
  });
});
