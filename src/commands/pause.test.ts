import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type * as configModule from "../lib/config.ts";
import { loadConfig, type ResolvedConfig } from "../lib/config.ts";
import { pausePath, readPause } from "../lib/pause.ts";
import { captureConsoleLog, type ConsoleCapture } from "../testHelpers/consoleCapture.ts";
import { parseDurationMilliseconds, parsePauseArguments, pauseCli, wakeCli } from "./pause.ts";

vi.mock(import("../lib/config.ts"), async (importOriginal) => {
  const actual = await importOriginal<typeof configModule>();
  return { ...actual, loadConfig: vi.fn<typeof loadConfig>() };
});

const loadConfigMock = vi.mocked(loadConfig);

function epochMilliseconds(iso: string | undefined): number {
  if (iso === undefined) {
    throw new Error("expected a timestamp");
  }
  return new Date(iso).getTime();
}

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

describe(parseDurationMilliseconds, () => {
  it("parses seconds, minutes, hours, and days", () => {
    expect(parseDurationMilliseconds("30s")).toBe(30_000);
    expect(parseDurationMilliseconds("45m")).toBe(2_700_000);
    expect(parseDurationMilliseconds("2h")).toBe(7_200_000);
    expect(parseDurationMilliseconds("1d")).toBe(86_400_000);
  });

  it("rejects malformed and zero durations", () => {
    expect(() => parseDurationMilliseconds("lunch")).toThrow(/expected a duration/);
    expect(() => parseDurationMilliseconds("2w")).toThrow(/expected a duration/);
    expect(() => parseDurationMilliseconds("h2")).toThrow(/expected a duration/);
    expect(() => parseDurationMilliseconds("0m")).toThrow(/expected a duration/);
    expect(() => parseDurationMilliseconds("")).toThrow(/expected a duration/);
  });
});

describe(parsePauseArguments, () => {
  it("parses --for and --reason in any combination", () => {
    expect(parsePauseArguments([])).toStrictEqual({});
    expect(parsePauseArguments(["--for", "2h"])).toStrictEqual({ forMilliseconds: 7_200_000 });
    expect(parsePauseArguments(["--reason", "standup"])).toStrictEqual({ reason: "standup" });
    expect(parsePauseArguments(["--for", "30m", "--reason", "lunch"])).toStrictEqual({
      forMilliseconds: 1_800_000,
      reason: "lunch",
    });
  });

  it("rejects missing values and unknown arguments", () => {
    expect(() => parsePauseArguments(["--for"])).toThrow(/duration is required/);
    expect(() => parsePauseArguments(["--for", "--reason"])).toThrow(/duration is required/);
    expect(() => parsePauseArguments(["--reason"])).toThrow(/reason text is required/);
    expect(() => parsePauseArguments(["now"])).toThrow(/unknown argument: now/);
  });
});

describe("pause and wake commands", () => {
  let stateRoot: string;
  let config: ResolvedConfig;
  let consoleLog: ConsoleCapture;

  beforeEach(() => {
    stateRoot = mkdtempSync(path.join(tmpdir(), "groundcrew-pause-cli-"));
    config = makeConfig(stateRoot);
    loadConfigMock.mockResolvedValue(config);
    consoleLog = captureConsoleLog();
  });

  afterEach(() => {
    consoleLog.restore();
    rmSync(stateRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("pause --for records an expiring pause and says so", async () => {
    await pauseCli(["--for", "2h", "--reason", "lunch"]);

    const state = readPause({ config });
    expect(state).toBeDefined();
    expect(state?.reason).toBe("lunch");
    const pausedAt = epochMilliseconds(state?.pausedAt);
    const until = epochMilliseconds(state?.until);
    expect(until - pausedAt).toBe(7_200_000);
    expect(consoleLog.output()).toContain(`Crew paused until ${state?.until} — lunch`);
    expect(consoleLog.output()).toContain("skips dispatch/review/clean while paused");
  });

  it("pause without --for records an indefinite pause", async () => {
    await pauseCli([]);

    expect(readPause({ config })).toBeDefined();
    expect(readPause({ config })?.until).toBeUndefined();
    expect(consoleLog.output()).toContain("Crew paused until `crew wake`");
  });

  it("wake clears the pause and reports both directions", async () => {
    await pauseCli([]);
    await wakeCli([]);

    expect(readPause({ config })).toBeUndefined();
    expect(existsSync(pausePath(config))).toBe(false);
    expect(consoleLog.output()).toContain("Crew is awake; the next tick resumes dispatch.");

    await wakeCli([]);
    expect(consoleLog.output()).toContain("Crew was not paused.");
  });

  it("wake rejects extra arguments", async () => {
    await expect(wakeCli(["now"])).rejects.toThrow("Usage: crew wake");
  });
});
