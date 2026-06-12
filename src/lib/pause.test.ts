import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ResolvedConfig } from "./config.ts";
import { clearPause, pausePath, readPause, recordPause } from "./pause.ts";

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

describe("pause store", () => {
  let stateRoot: string;
  let config: ResolvedConfig;

  beforeEach(() => {
    stateRoot = mkdtempSync(path.join(tmpdir(), "groundcrew-pause-"));
    config = makeConfig(stateRoot);
  });

  afterEach(() => {
    rmSync(stateRoot, { recursive: true, force: true });
  });

  it("round-trips a pause with expiry and reason next to the log file", () => {
    const now = new Date("2026-06-13T08:00:00.000Z");
    const until = new Date("2026-06-13T10:00:00.000Z");

    const written = recordPause({ config, until, reason: "lunch", now });

    expect(written).toStrictEqual({
      pausedAt: "2026-06-13T08:00:00.000Z",
      until: "2026-06-13T10:00:00.000Z",
      reason: "lunch",
    });
    expect(pausePath(config)).toBe(path.join(stateRoot, "pause.json"));
    expect(readPause({ config, now })).toStrictEqual(written);
  });

  it("treats an indefinite pause as active until cleared", () => {
    const now = new Date("2026-06-13T08:00:00.000Z");
    recordPause({ config, now });

    const farFuture = new Date("2027-01-01T00:00:00.000Z");
    expect(readPause({ config, now: farFuture })).toStrictEqual({
      pausedAt: "2026-06-13T08:00:00.000Z",
    });

    expect(clearPause({ config })).toBe(true);
    expect(readPause({ config, now })).toBeUndefined();
    expect(clearPause({ config })).toBe(false);
  });

  it("auto-wakes at expiry and removes the pause file", () => {
    const now = new Date("2026-06-13T08:00:00.000Z");
    recordPause({ config, until: new Date("2026-06-13T09:00:00.000Z"), now });

    const beforeExpiry = new Date("2026-06-13T08:59:59.000Z");
    expect(readPause({ config, now: beforeExpiry })).toBeDefined();

    const atExpiry = new Date("2026-06-13T09:00:00.000Z");
    expect(readPause({ config, now: atExpiry })).toBeUndefined();
    expect(existsSync(pausePath(config))).toBe(false);
  });

  it("deletes malformed pause files instead of staying paused forever", () => {
    writeFileSync(pausePath(config), "not json");
    expect(readPause({ config })).toBeUndefined();
    expect(existsSync(pausePath(config))).toBe(false);

    writeFileSync(pausePath(config), JSON.stringify({ until: "2099-01-01T00:00:00.000Z" }));
    expect(readPause({ config })).toBeUndefined();

    writeFileSync(pausePath(config), JSON.stringify([1, 2]));
    expect(readPause({ config })).toBeUndefined();

    writeFileSync(pausePath(config), JSON.stringify({ pausedAt: "not a date" }));
    expect(readPause({ config })).toBeUndefined();
  });

  it("drops blank reasons and invalid expiries while keeping the pause", () => {
    writeFileSync(
      pausePath(config),
      JSON.stringify({ pausedAt: "2026-06-13T08:00:00.000Z", until: "garbage", reason: "" }),
    );

    expect(readPause({ config, now: new Date("2026-06-13T08:30:00.000Z") })).toStrictEqual({
      pausedAt: "2026-06-13T08:00:00.000Z",
    });
  });

  it("reads as awake when no pause was ever recorded", () => {
    expect(readPause({ config })).toBeUndefined();
    expect(clearPause({ config })).toBe(false);
  });
});
