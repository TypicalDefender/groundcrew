import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type * as configModule from "../lib/config.ts";
import { loadConfig, type ResolvedConfig } from "../lib/config.ts";
import { readRunState, recordRunState } from "../lib/runState.ts";
import { captureConsoleLog, type ConsoleCapture } from "../testHelpers/consoleCapture.ts";
import { parseSnoozeArguments, parseSnoozeUntil, snoozeCli } from "./snooze.ts";

vi.mock(import("../lib/config.ts"), async (importOriginal) => {
  const actual = await importOriginal<typeof configModule>();
  return { ...actual, loadConfig: vi.fn<typeof loadConfig>() };
});

const loadConfigMock = vi.mocked(loadConfig);

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

describe(parseSnoozeUntil, () => {
  const NOW = new Date("2026-06-13T08:00:00.000Z");

  it("offsets durations from now and accepts absolute future timestamps", () => {
    expect(parseSnoozeUntil("2h", NOW).toISOString()).toBe("2026-06-13T10:00:00.000Z");
    expect(parseSnoozeUntil("45m", NOW).toISOString()).toBe("2026-06-13T08:45:00.000Z");
    expect(parseSnoozeUntil("2026-06-14T09:00:00.000Z", NOW).toISOString()).toBe(
      "2026-06-14T09:00:00.000Z",
    );
  });

  it("rejects garbage and past timestamps", () => {
    expect(() => parseSnoozeUntil("whenever", NOW)).toThrow(/expected a duration like 2h/);
    expect(() => parseSnoozeUntil("2026-06-13T07:00:00.000Z", NOW)).toThrow(/not in the future/);
    expect(() => parseSnoozeUntil("2026-06-13T08:00:00.000Z", NOW)).toThrow(/not in the future/);
  });
});

describe(parseSnoozeArguments, () => {
  it("parses --until and --clear forms and lowercases the task", () => {
    expect(parseSnoozeArguments(["TEAM-1", "--until", "2h"])).toStrictEqual({
      task: "team-1",
      clear: false,
      until: "2h",
    });
    expect(parseSnoozeArguments(["team-1", "--clear"])).toStrictEqual({
      task: "team-1",
      clear: true,
    });
  });

  it("rejects missing task, missing value, both flags, and neither flag", () => {
    expect(() => parseSnoozeArguments(["--until", "2h"])).toThrow(/Usage: crew snooze/);
    expect(() => parseSnoozeArguments(["team-1", "--until"])).toThrow(/time or duration/);
    expect(() => parseSnoozeArguments(["team-1", "--until", "--clear"])).toThrow(
      /time or duration/,
    );
    expect(() => parseSnoozeArguments(["team-1", "--until", "2h", "--clear"])).toThrow(
      /exactly one of/,
    );
    expect(() => parseSnoozeArguments(["team-1"])).toThrow(/exactly one of/);
    expect(() => parseSnoozeArguments(["team-1", "extra", "--clear"])).toThrow(
      /Usage: crew snooze/,
    );
    expect(() => parseSnoozeArguments(["team-1", "--force"])).toThrow(/Unknown option: --force/);
  });
});

describe("snooze command", () => {
  let stateRoot: string;
  let config: ResolvedConfig;
  let consoleLog: ConsoleCapture;

  beforeEach(() => {
    stateRoot = mkdtempSync(path.join(tmpdir(), "groundcrew-snooze-cli-"));
    config = makeConfig(stateRoot);
    loadConfigMock.mockResolvedValue(config);
    consoleLog = captureConsoleLog();
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
  });

  afterEach(() => {
    consoleLog.restore();
    rmSync(stateRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("stores the snooze on the run state without bumping updatedAt", async () => {
    const before = readRunState(config, "team-1")?.updatedAt;

    await snoozeCli(["team-1", "--until", "2026-12-01T09:00:00.000Z"]);

    const after = readRunState(config, "team-1");
    expect(after?.snoozedUntil).toBe("2026-12-01T09:00:00.000Z");
    expect(after?.updatedAt).toBe(before);
    expect(consoleLog.output()).toContain(
      "Snoozed team-1 until 2026-12-01T09:00:00.000Z; dispatch skips it",
    );
  });

  it("clears the snooze with --clear", async () => {
    await snoozeCli(["team-1", "--until", "1d"]);
    expect(readRunState(config, "team-1")?.snoozedUntil).toBeDefined();

    await snoozeCli(["team-1", "--clear"]);

    expect(readRunState(config, "team-1")?.snoozedUntil).toBeUndefined();
    expect(consoleLog.output()).toContain("Cleared the snooze on team-1");
  });

  it("fails clearly when the task has never been dispatched", async () => {
    await expect(snoozeCli(["ghost", "--until", "2h"])).rejects.toThrow(
      /No run state for ghost — snooze applies to tasks the crew has dispatched/,
    );
    await expect(snoozeCli(["ghost", "--clear"])).rejects.toThrow(
      /No run state for ghost; nothing to clear/,
    );
  });
});
