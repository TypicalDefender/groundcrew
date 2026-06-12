/**
 * Pause gating for the orchestrator's tick, exercised against a real
 * todo-txt source and a real pause file in a temp state dir — only the
 * workspace launch and the clock-ish edges (sleep) are stubbed.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type * as configModule from "../lib/config.ts";
import { loadConfigWithSource, type ResolvedConfig } from "../lib/config.ts";
import { clearPause, recordPause } from "../lib/pause.ts";
import { getUsageByAgent } from "../lib/usage.ts";
import type * as utilModule from "../lib/util.ts";
import { sleep } from "../lib/util.ts";
import { captureConsoleLog, type ConsoleCapture } from "../testHelpers/consoleCapture.ts";
import { orchestrate } from "./orchestrator.ts";
import { setupWorkspace } from "./setupWorkspace.ts";

vi.mock(import("../lib/config.ts"), async (importOriginal) => {
  const actual = await importOriginal<typeof configModule>();
  return { ...actual, loadConfigWithSource: vi.fn<typeof loadConfigWithSource>() };
});
vi.mock(import("../lib/util.ts"), async (importOriginal) => {
  const actual = await importOriginal<typeof utilModule>();
  return {
    ...actual,
    sleep: vi.fn<typeof sleep>(),
    log: vi.fn<typeof actual.log>((message: string) => {
      actual.writeOutput(`[log] ${message}`);
    }),
  };
});
vi.mock(import("../lib/usage.ts"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getUsageByAgent: vi.fn<typeof getUsageByAgent>() };
});
vi.mock(import("./setupWorkspace.ts"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, setupWorkspace: vi.fn<typeof setupWorkspace>() };
});

const loadConfigMock = vi.mocked(loadConfigWithSource);
const sleepMock = vi.mocked(sleep);
const usageMock = vi.mocked(getUsageByAgent);
const setupMock = vi.mocked(setupWorkspace);

function makeConfig(stateRoot: string): ResolvedConfig {
  return {
    sources: [
      {
        kind: "todo-txt",
        name: "todo",
        todoPath: path.join(stateRoot, "todo.txt"),
        tasksDir: path.join(stateRoot, ".tasks"),
        idPrefix: "GC",
        timezone: "UTC",
      },
    ],
    defaults: { hooks: {} },
    git: { remote: "origin", defaultBranch: "main" },
    workspace: {
      projectDir: path.join(stateRoot, "project"),
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

/**
 * Sleep stub for watch mode: runs `between` after the first post-tick
 * sleep, then ends the loop via the orchestrator's own SIGINT handler.
 */
function watchTwoTicks(between: () => void): () => Promise<void> {
  let sleeps = 0;
  return async () => {
    sleeps += 1;
    if (sleeps === 1) {
      between();
      return;
    }
    process.listeners("SIGINT").at(-1)?.("SIGINT");
  };
}

describe("orchestrator pause gating", () => {
  let stateRoot: string;
  let config: ResolvedConfig;
  let consoleLog: ConsoleCapture;

  beforeEach(() => {
    stateRoot = mkdtempSync(path.join(tmpdir(), "groundcrew-orch-pause-"));
    config = makeConfig(stateRoot);
    writeFileSync(
      path.join(stateRoot, "todo.txt"),
      "Say hello id:t-1 repo:repo-a agent:claude status:todo\n",
    );
    loadConfigMock.mockResolvedValue({
      config,
      source: { kind: "xdg", filepath: "/tmp/crew.config.ts" },
    });
    sleepMock.mockResolvedValue();
    usageMock.mockResolvedValue({});
    setupMock.mockResolvedValue();
    consoleLog = captureConsoleLog();
  });

  afterEach(() => {
    consoleLog.restore();
    rmSync(stateRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("skips dispatch on a paused tick and reports the expiry and reason", async () => {
    recordPause({
      config,
      until: new Date("2099-01-01T00:00:00.000Z"),
      reason: "lunch",
      now: new Date("2026-06-13T08:00:00.000Z"),
    });

    await orchestrate({ watch: false, dryRun: false });

    expect(consoleLog.output()).toContain(
      "Paused until 2099-01-01T00:00:00.000Z (lunch); skipping dispatch/review/clean",
    );
    expect(setupMock).not.toHaveBeenCalled();
  });

  it("resumes dispatch on the tick after the pause lifts", async () => {
    recordPause({ config, now: new Date("2026-06-13T08:00:00.000Z") });
    sleepMock.mockImplementation(
      watchTwoTicks(() => {
        clearPause({ config });
      }),
    );

    await orchestrate({ watch: true, dryRun: false });

    const out = consoleLog.output();
    expect(out).toContain("Paused until `crew wake`; skipping dispatch/review/clean");
    expect(out).toContain("next poll in 1s");
    expect(setupMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ task: "t-1", repository: "repo-a", agent: "claude" }),
      expect.anything(),
    );
  });
});
