import { captureConsoleLog } from "../testHelpers/consoleCapture.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadConfigWithSource, type ResolvedConfig } from "../lib/config.ts";
import {
  deck,
  deckCli,
  deckCommandPlan,
  type DeckStep,
  parseDeckArguments,
  runDeckStepInherited,
} from "./deck.ts";

vi.mock(import("../lib/config.ts"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, loadConfigWithSource: vi.fn<typeof actual.loadConfigWithSource>() };
});

const loadConfigWithSourceMock = vi.mocked(loadConfigWithSource);

function makeConfig(port = 4400): ResolvedConfig {
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
    deck: { port, pollIntervalMilliseconds: 5000 },
    logging: { file: "/tmp/groundcrew-test.log" },
  };
}

vi.mock(import("../lib/configRegistry.ts"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, registerConfig: vi.fn<typeof actual.registerConfig>(() => []) };
});

describe(deckCommandPlan, () => {
  it("plans a build then a start on the configured port", () => {
    const steps = deckCommandPlan({ config: makeConfig(4400), options: {}, deckDir: "/d" });

    expect(steps).toStrictEqual([
      { command: "npx", args: ["next", "build"], cwd: "/d" },
      { command: "npx", args: ["next", "start", "--port", "4400"], cwd: "/d" },
    ]);
  });

  it("prefers a port override from the CLI over config", () => {
    const steps = deckCommandPlan({
      config: makeConfig(4400),
      options: { port: 5111 },
      deckDir: "/d",
    });

    expect(steps.at(-1)?.args).toStrictEqual(["next", "start", "--port", "5111"]);
  });

  it("plans only the dev server with --dev", () => {
    const steps = deckCommandPlan({ config: makeConfig(), options: { dev: true }, deckDir: "/d" });

    expect(steps).toStrictEqual([
      { command: "npx", args: ["next", "dev", "--port", "4400"], cwd: "/d" },
    ]);
  });

  it("exports the crew config path to every server step", () => {
    const steps = deckCommandPlan({
      config: makeConfig(),
      options: {},
      deckDir: "/d",
      configPath: "/work/crew.config.ts",
    });

    expect(steps.every((step) => step.env?.["GROUNDCREW_CONFIG"] === "/work/crew.config.ts")).toBe(
      true,
    );
    expect(steps.every((step) => step.env?.["GROUNDCREW_PROJECT_CWD"] === process.cwd())).toBe(
      true,
    );
  });

  it("skips the build with --no-build", () => {
    const steps = deckCommandPlan({
      config: makeConfig(),
      options: { skipBuild: true },
      deckDir: "/d",
    });

    expect(steps).toStrictEqual([
      { command: "npx", args: ["next", "start", "--port", "4400"], cwd: "/d" },
    ]);
  });
});

describe(parseDeckArguments, () => {
  it("parses port, dev, and no-build flags", () => {
    expect(parseDeckArguments([])).toStrictEqual({});
    expect(parseDeckArguments(["--port", "5111"])).toStrictEqual({ port: 5111 });
    expect(parseDeckArguments(["--dev"])).toStrictEqual({ dev: true });
    expect(parseDeckArguments(["--no-build"])).toStrictEqual({ skipBuild: true });
    expect(parseDeckArguments(["--all"])).toStrictEqual({ all: true });
  });

  it("rejects unknown flags and bad ports", () => {
    expect(() => parseDeckArguments(["--port", "zero"])).toThrow(/Usage: crew deck/);
    expect(() => parseDeckArguments(["--port", "0"])).toThrow(/Usage: crew deck/);
    expect(() => parseDeckArguments(["--what"])).toThrow(/Usage: crew deck/);
  });
});

describe(deck, () => {
  let deckDir: string;

  beforeEach(() => {
    deckDir = mkdtempSync(path.join(tmpdir(), "groundcrew-deck-test-"));
  });

  afterEach(() => {
    rmSync(deckDir, { recursive: true, force: true });
  });

  it("runs every planned step in order against the deck dir", async () => {
    const ran: DeckStep[] = [];
    const runStep = vi.fn<(step: DeckStep) => Promise<number>>(async (step) => {
      ran.push(step);
      return 0;
    });

    await deck({ config: makeConfig(), options: {}, deckDir, runStep });

    expect(ran.map((step) => step.args[1])).toStrictEqual(["build", "start"]);
    expect(ran.every((step) => step.cwd === deckDir)).toBe(true);
  });

  it("threads the config path through to the planned steps", async () => {
    const ran: DeckStep[] = [];
    const runStep = vi.fn<(step: DeckStep) => Promise<number>>(async (step) => {
      ran.push(step);
      return 0;
    });

    await deck({
      config: makeConfig(),
      options: { skipBuild: true },
      deckDir,
      configPath: "/work/crew.config.ts",
      runStep,
    });

    expect(ran[0]?.env).toStrictEqual({
      GROUNDCREW_CONFIG: "/work/crew.config.ts",
      GROUNDCREW_PROJECT_CWD: process.cwd(),
    });
  });

  it("stops and throws when a step exits non-zero", async () => {
    const runStep = vi.fn<() => Promise<number>>(async () => 1);

    await expect(deck({ config: makeConfig(), options: {}, deckDir, runStep })).rejects.toThrow(
      /exited with code 1/,
    );
    expect(runStep).toHaveBeenCalledTimes(1);
  });

  it("refuses to run when the deck workspace is missing", async () => {
    await expect(
      deck({
        config: makeConfig(),
        options: {},
        deckDir: path.join(deckDir, "not-there"),
        runStep: vi.fn<() => Promise<number>>(async () => 0),
      }),
    ).rejects.toThrow(/Deck workspace not found/);
  });

  it("resolves the repo deck workspace by default", async () => {
    const ran: DeckStep[] = [];
    const runStep = vi.fn<(step: DeckStep) => Promise<number>>(async (step) => {
      ran.push(step);
      return 0;
    });

    await deck({ config: makeConfig(), options: { skipBuild: true }, runStep });

    expect(ran[0]?.cwd.endsWith("/deck")).toBe(true);
  });
});

describe(deckCli, () => {
  it("loads config, parses flags, and hands off to the runner", async () => {
    loadConfigWithSourceMock.mockResolvedValue({
      config: makeConfig(4567),
      source: { kind: "project", filepath: "/work/crew.config.ts" },
    });
    const runDeck = vi.fn<typeof deck>().mockResolvedValue();

    await deckCli(["--no-build"], runDeck);

    expect(runDeck).toHaveBeenCalledTimes(1);
    const input = runDeck.mock.calls[0]?.[0];
    expect(input?.config.deck).toStrictEqual({ port: 4567, pollIntervalMilliseconds: 5000 });
    expect(input?.options).toStrictEqual({ skipBuild: true });
    expect(input?.configPath).toBe("/work/crew.config.ts");
  });
});

describe("deckCli --all", () => {
  it("announces the portfolio URL before serving", async () => {
    loadConfigWithSourceMock.mockResolvedValue({
      config: makeConfig(4567),
      source: { kind: "project", filepath: "/work/crew.config.ts" },
    });
    const consoleLog = captureConsoleLog();
    const runDeck = vi.fn<typeof deck>().mockResolvedValue();

    await deckCli(["--all", "--no-build"], runDeck);
    consoleLog.restore();

    expect(consoleLog.output()).toContain("Portfolio view: http://localhost:4567/portfolio");
    expect(runDeck.mock.calls[0]?.[0]?.options).toStrictEqual({ all: true, skipBuild: true });
  });
});

describe(runDeckStepInherited, () => {
  it("resolves with the child exit code", async () => {
    await expect(runDeckStepInherited({ command: "true", args: [], cwd: tmpdir() })).resolves.toBe(
      0,
    );
    await expect(runDeckStepInherited({ command: "false", args: [], cwd: tmpdir() })).resolves.toBe(
      1,
    );
  });

  it("rejects when the command cannot be spawned", async () => {
    await expect(
      runDeckStepInherited({
        command: "definitely-not-a-real-binary-x9z",
        args: [],
        cwd: tmpdir(),
      }),
    ).rejects.toThrow(/ENOENT/);
  });
});
