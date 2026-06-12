import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ResolvedConfig } from "./config.ts";
import {
  claudeProjectSlug,
  decayByAge,
  detectAwaitingInput,
  PULSE_THRESHOLDS,
  pulseDirectory,
  readPulse,
} from "./pulse.ts";
import { recordRunState } from "./runState.ts";
import { type WorkspaceProbe, workspaces } from "./workspaces.ts";

vi.mock(import("./workspaces.ts"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    workspaces: {
      ...actual.workspaces,
      probe: vi.fn<typeof actual.workspaces.probe>(),
      capturePane: vi.fn<typeof actual.workspaces.capturePane>(),
    },
  };
});

const probeMock = vi.mocked(workspaces.probe);
const capturePaneMock = vi.mocked(workspaces.capturePane);

const NOW = Date.parse("2026-06-12T12:00:00.000Z");

function okProbe(names: string[], exitedNames: string[] = []): WorkspaceProbe {
  return exitedNames.length === 0
    ? { kind: "ok", names: new Set(names) }
    : { kind: "ok", names: new Set(names), exitedNames: new Set(exitedNames) };
}

describe(decayByAge, () => {
  it("classifies ages against the threshold block", () => {
    expect(decayByAge(0)).toBe("active");
    expect(decayByAge(PULSE_THRESHOLDS.activeWindowMilliseconds)).toBe("active");
    expect(decayByAge(PULSE_THRESHOLDS.activeWindowMilliseconds + 1)).toBe("ready");
    expect(decayByAge(PULSE_THRESHOLDS.readyWindowMilliseconds)).toBe("ready");
    expect(decayByAge(PULSE_THRESHOLDS.readyWindowMilliseconds + 1)).toBe("idle");
  });
});

describe(detectAwaitingInput, () => {
  it("detects y/n confirmation suffixes", () => {
    expect(detectAwaitingInput("Overwrite existing file? (y/n)")).toBe(true);
    expect(detectAwaitingInput("Continue [y/n]")).toBe(true);
  });

  it("detects question-style and picker prompts", () => {
    expect(detectAwaitingInput("Do you want to make this edit?")).toBe(true);
    expect(detectAwaitingInput("Would you like to run the command?")).toBe(true);
    expect(detectAwaitingInput("❯ 1. Yes\n  2. No")).toBe(true);
    expect(detectAwaitingInput("Press enter to continue")).toBe(true);
  });

  it("ignores plain agent output", () => {
    expect(detectAwaitingInput("Compiled 14 files\nAll tests passed\n")).toBe(false);
  });

  it("ignores prompts buried outside the pane tail", () => {
    const buried = [
      "Do you want to proceed?",
      ...Array.from({ length: 25 }, (_, index) => `line ${index}`),
    ].join("\n");

    expect(detectAwaitingInput(buried)).toBe(false);
  });
});

describe(claudeProjectSlug, () => {
  it("maps every non-alphanumeric character except dashes to a dash", () => {
    expect(claudeProjectSlug("/Users/me/dev/repo_a.x")).toBe("-Users-me-dev-repo-a-x");
  });
});

describe(readPulse, () => {
  let stateRoot: string;
  let homeDirectory: string;
  let worktreeDir: string;
  let config: ResolvedConfig;

  function makeConfig(): ResolvedConfig {
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
        definitions: {
          claude: { cmd: "claude", color: "#fff" },
          codex: { cmd: "codex", color: "#000" },
        },
      },
      prompts: { initial: "x" },
      workspaceKind: "auto",
      local: { runner: "auto" },
      deck: { port: 4400, pollIntervalMilliseconds: 5000 },
      logging: { file: path.join(stateRoot, "groundcrew.log") },
    };
  }

  function recordRun(agent: string): void {
    recordRunState({
      config,
      state: {
        task: "team-1",
        repository: "repo-a",
        agent,
        worktreeDir,
        branchName: "dev-team-1",
        workspaceName: "team-1",
        state: "running",
      },
    });
  }

  function writeClaudeSession(arguments_: { ageMilliseconds: number; lastLine?: string }): void {
    const slug = claudeProjectSlug(realpathSync(worktreeDir));
    const projectDir = path.join(homeDirectory, ".claude", "projects", slug);
    mkdirSync(projectDir, { recursive: true });
    const filePath = path.join(projectDir, "session-1.jsonl");
    writeFileSync(filePath, `${arguments_.lastLine ?? '{"type":"assistant"}'}\n`);
    const mtimeSeconds = (NOW - arguments_.ageMilliseconds) / 1000;
    utimesSync(filePath, mtimeSeconds, mtimeSeconds);
  }

  function writeCodexSession(arguments_: { cwd: string; ageMilliseconds: number }): string {
    const shardDir = path.join(homeDirectory, ".codex", "sessions", "2026", "06", "12");
    mkdirSync(shardDir, { recursive: true });
    const filePath = path.join(shardDir, `rollout-${arguments_.cwd.length}-x.jsonl`);
    writeFileSync(
      filePath,
      `${JSON.stringify({ type: "session_meta", payload: { id: "s", cwd: arguments_.cwd } })}\n`,
    );
    const mtimeSeconds = (NOW - arguments_.ageMilliseconds) / 1000;
    utimesSync(filePath, mtimeSeconds, mtimeSeconds);
    return filePath;
  }

  beforeEach(() => {
    stateRoot = mkdtempSync(path.join(tmpdir(), "groundcrew-pulse-state-"));
    homeDirectory = mkdtempSync(path.join(tmpdir(), "groundcrew-pulse-home-"));
    worktreeDir = mkdtempSync(path.join(tmpdir(), "groundcrew-pulse-tree-"));
    config = makeConfig();
    probeMock.mockResolvedValue(okProbe(["team-1"]));
    // oxlint-disable-next-line unicorn/no-useless-undefined -- default: no pane capture available
    capturePaneMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(homeDirectory, { recursive: true, force: true });
    rmSync(worktreeDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  async function pulse(): Promise<Awaited<ReturnType<typeof readPulse>>> {
    return await readPulse({ config, task: "team-1", homeDirectory, now: NOW });
  }

  it("reports gone when the workspace session is missing", async () => {
    probeMock.mockResolvedValue(okProbe([]));

    await expect(pulse()).resolves.toStrictEqual({
      state: "gone",
      source: "workspace",
      detail: "no workspace session",
    });
  });

  it("reports gone when the workspace session has exited", async () => {
    probeMock.mockResolvedValue(okProbe(["team-1"], ["team-1"]));

    await expect(pulse()).resolves.toStrictEqual({
      state: "gone",
      source: "workspace",
      detail: "workspace session exited",
    });
  });

  it("reports active from a fresh claude session log, beating a visible prompt", async () => {
    recordRun("claude");
    writeClaudeSession({ ageMilliseconds: 5000 });
    capturePaneMock.mockResolvedValue("Do you want to proceed?");

    const actual = await pulse();

    expect(actual.state).toBe("active");
    expect(actual.source).toBe("agent-native");
  });

  it("upgrades a quiet claude session to awaiting-input when the pane shows a prompt", async () => {
    recordRun("claude");
    writeClaudeSession({ ageMilliseconds: 60_000 });
    capturePaneMock.mockResolvedValue("Do you want to make this edit?\n❯ 1. Yes\n  2. No");

    await expect(pulse()).resolves.toStrictEqual({
      state: "awaiting-input",
      source: "pane",
      detail: "prompt visible in pane",
    });
  });

  it("decays claude signals from ready to idle by age", async () => {
    recordRun("claude");
    writeClaudeSession({ ageMilliseconds: 60_000 });

    await expect(pulse()).resolves.toMatchObject({ state: "ready", source: "agent-native" });

    writeClaudeSession({ ageMilliseconds: 10 * 60_000 });

    await expect(pulse()).resolves.toMatchObject({ state: "idle", source: "agent-native" });
  });

  it("reports blocked when claude's last entry is an api error", async () => {
    recordRun("claude");
    writeClaudeSession({
      ageMilliseconds: 5000,
      lastLine: '{"type":"system","subtype":"api_error","level":"error"}',
    });

    await expect(pulse()).resolves.toMatchObject({
      state: "blocked",
      source: "agent-native",
      detail: "agent error",
    });
  });

  it("falls back to pane-hash decay when the claude session log is missing", async () => {
    recordRun("claude");
    capturePaneMock.mockResolvedValue("building...\n");

    // First sighting of this pane content counts as a change: active.
    await expect(pulse()).resolves.toMatchObject({ state: "active", source: "pane" });

    // Same pane content one minute later has decayed to ready.
    const later = await readPulse({
      config,
      task: "team-1",
      homeDirectory,
      now: NOW + 60_000,
    });
    expect(later).toMatchObject({ state: "ready", source: "pane" });

    // Same pane content past the ready window is idle.
    const muchLater = await readPulse({
      config,
      task: "team-1",
      homeDirectory,
      now: NOW + 10 * 60_000,
    });
    expect(muchLater).toMatchObject({ state: "idle", source: "pane" });
    expect(pulseDirectory(config)).toBe(path.join(stateRoot, "pulse"));
  });

  it("treats changed pane content as fresh activity", async () => {
    recordRun("claude");
    capturePaneMock.mockResolvedValue("step one\n");
    await pulse();

    capturePaneMock.mockResolvedValue("step two\n");
    const actual = await readPulse({
      config,
      task: "team-1",
      homeDirectory,
      now: NOW + 60_000,
    });

    expect(actual).toMatchObject({ state: "active", source: "pane" });
  });

  it("uses pane signals alone for tasks with no run state", async () => {
    capturePaneMock.mockResolvedValue("Continue [y/n]");

    await expect(pulse()).resolves.toMatchObject({ state: "awaiting-input", source: "pane" });
  });

  it("reports idle with a detail when no probe yields a signal", async () => {
    probeMock.mockResolvedValue({ kind: "unavailable", error: new Error("down") });

    await expect(pulse()).resolves.toStrictEqual({
      state: "idle",
      source: "pane",
      detail: "no activity signal available",
    });
  });

  it("reads codex activity from the rollout file recorded for the launch dir", async () => {
    recordRun("codex");
    writeCodexSession({ cwd: realpathSync(worktreeDir), ageMilliseconds: 5000 });
    writeCodexSession({ cwd: "/somewhere/else", ageMilliseconds: 1000 });

    await expect(pulse()).resolves.toMatchObject({ state: "active", source: "agent-native" });
  });

  it("reuses the memoized codex rollout file on later reads", async () => {
    recordRun("codex");
    const matched = writeCodexSession({
      cwd: realpathSync(worktreeDir),
      ageMilliseconds: 5000,
    });
    await pulse();

    // Age the matched file and re-read: the memoized path still resolves
    // without a directory walk, and the state decays by its new age.
    const mtimeSeconds = (NOW - 60_000) / 1000;
    utimesSync(matched, mtimeSeconds, mtimeSeconds);

    await expect(pulse()).resolves.toMatchObject({ state: "ready", source: "agent-native" });
  });

  it("falls back past codex when no rollout file matches the launch dir", async () => {
    recordRun("codex");
    writeCodexSession({ cwd: "/somewhere/else", ageMilliseconds: 1000 });
    capturePaneMock.mockResolvedValue("compiling\n");

    await expect(pulse()).resolves.toMatchObject({ state: "active", source: "pane" });
  });

  it("uses default clock and home when not injected", async () => {
    probeMock.mockResolvedValue(okProbe([]));

    await expect(readPulse({ config, task: "team-1" })).resolves.toMatchObject({
      state: "gone",
    });
  });

  it("accepts a pre-loaded run state instead of re-reading it", async () => {
    const runState = recordRunState({
      config,
      state: {
        task: "team-1",
        repository: "repo-a",
        agent: "claude",
        worktreeDir,
        branchName: "dev-team-1",
        workspaceName: "team-1",
        state: "running",
      },
    });
    writeClaudeSession({ ageMilliseconds: 5000 });

    const actual = await readPulse({ config, task: "team-1", runState, homeDirectory, now: NOW });

    expect(actual).toMatchObject({ state: "active", source: "agent-native" });
  });

  it("falls back to the recorded worktree dir when the repository left the config", async () => {
    recordRunState({
      config,
      state: {
        task: "team-1",
        repository: "ghost-repo",
        agent: "claude",
        worktreeDir,
        branchName: "dev-team-1",
        workspaceName: "team-1",
        state: "running",
      },
    });
    writeClaudeSession({ ageMilliseconds: 5000 });

    await expect(pulse()).resolves.toMatchObject({ state: "active", source: "agent-native" });
  });

  it("skips the native probe for agents that are neither claude nor codex", async () => {
    recordRun("mystery");
    writeClaudeSession({ ageMilliseconds: 5000 });
    capturePaneMock.mockResolvedValue("compiling\n");

    await expect(pulse()).resolves.toMatchObject({ state: "active", source: "pane" });
  });

  it("slugs the literal worktree path when it no longer resolves", async () => {
    recordRun("claude");
    rmSync(worktreeDir, { recursive: true, force: true });

    await expect(pulse()).resolves.toMatchObject({ state: "idle", source: "pane" });
  });

  it("ignores unparseable and non-object last lines when checking for errors", async () => {
    recordRun("claude");
    writeClaudeSession({ ageMilliseconds: 60_000, lastLine: "not json at all" });

    await expect(pulse()).resolves.toMatchObject({ state: "ready", source: "agent-native" });

    writeClaudeSession({ ageMilliseconds: 60_000, lastLine: "42" });

    await expect(pulse()).resolves.toMatchObject({ state: "ready", source: "agent-native" });
  });

  it("treats an all-blank session file as having no last entry", async () => {
    recordRun("claude");
    writeClaudeSession({ ageMilliseconds: 60_000, lastLine: "" });

    await expect(pulse()).resolves.toMatchObject({ state: "ready", source: "agent-native" });
  });

  it("ignores agent- prefixed files and picks the newest session file", async () => {
    recordRun("claude");
    const slug = claudeProjectSlug(realpathSync(worktreeDir));
    const projectDir = path.join(homeDirectory, ".claude", "projects", slug);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "agent-helper.jsonl"), '{"type":"assistant"}\n');
    const oldFile = path.join(projectDir, "old.jsonl");
    writeFileSync(oldFile, '{"type":"assistant"}\n');
    utimesSync(oldFile, (NOW - 600_000) / 1000, (NOW - 600_000) / 1000);
    const newFile = path.join(projectDir, "new.jsonl");
    writeFileSync(newFile, '{"type":"assistant"}\n');
    utimesSync(newFile, (NOW - 5000) / 1000, (NOW - 5000) / 1000);

    await expect(pulse()).resolves.toMatchObject({ state: "active", source: "agent-native" });
  });

  it("skips unmatchable codex rollout files and accepts a top-level cwd", async () => {
    recordRun("codex");
    const shardDir = path.join(homeDirectory, ".codex", "sessions", "2026", "06", "12");
    mkdirSync(shardDir, { recursive: true });
    writeFileSync(path.join(shardDir, "rollout-empty.jsonl"), "");
    writeFileSync(path.join(shardDir, "rollout-garbage.jsonl"), "not json\n");
    writeFileSync(path.join(shardDir, "rollout-scalar.jsonl"), "42\n");
    writeFileSync(path.join(shardDir, "notes.txt"), "irrelevant\n");
    // Top-level cwd (no payload) and no trailing newline.
    const matched = path.join(shardDir, "rollout-top.jsonl");
    writeFileSync(matched, JSON.stringify({ cwd: realpathSync(worktreeDir) }));
    utimesSync(matched, (NOW - 5000) / 1000, (NOW - 5000) / 1000);

    await expect(pulse()).resolves.toMatchObject({ state: "active", source: "agent-native" });
  });

  it("does not scan codex shards beyond the depth limit", async () => {
    recordRun("codex");
    const tooDeep = path.join(
      homeDirectory,
      ".codex",
      "sessions",
      "2026",
      "06",
      "12",
      "extra",
      "deep",
    );
    mkdirSync(tooDeep, { recursive: true });
    writeFileSync(
      path.join(tooDeep, "rollout-deep.jsonl"),
      `${JSON.stringify({ payload: { cwd: realpathSync(worktreeDir) } })}\n`,
    );

    await expect(pulse()).resolves.toMatchObject({
      state: "idle",
      detail: "no activity signal available",
    });
  });

  it("walks the shards again after the memoized codex rollout file disappears", async () => {
    recordRun("codex");
    const matched = writeCodexSession({ cwd: realpathSync(worktreeDir), ageMilliseconds: 5000 });
    await pulse();

    rmSync(matched);
    capturePaneMock.mockResolvedValue("compiling\n");

    await expect(pulse()).resolves.toMatchObject({ state: "active", source: "pane" });
  });

  it("tolerates corrupt pulse memo files", async () => {
    recordRun("mystery");
    mkdirSync(path.join(stateRoot, "pulse"), { recursive: true });
    writeFileSync(path.join(stateRoot, "pulse", "team-1.json"), "not json");
    capturePaneMock.mockResolvedValue("building\n");

    await expect(pulse()).resolves.toMatchObject({ state: "active", source: "pane" });

    writeFileSync(path.join(stateRoot, "pulse", "team-1.json"), '"a scalar"');

    await expect(pulse()).resolves.toMatchObject({ state: "active", source: "pane" });
  });

  it("re-stamps a memo that has a hash but no change timestamp", async () => {
    recordRun("mystery");
    const paneText = "building\n";
    const hash = createHash("sha256").update(paneText).digest("hex");
    mkdirSync(path.join(stateRoot, "pulse"), { recursive: true });
    writeFileSync(path.join(stateRoot, "pulse", "team-1.json"), JSON.stringify({ paneHash: hash }));
    capturePaneMock.mockResolvedValue(paneText);

    await expect(pulse()).resolves.toMatchObject({ state: "active", source: "pane" });
  });

  it("still reports a pane verdict when the memo cannot be written", async () => {
    recordRun("mystery");
    // A file where the pulse directory should be makes every memo write fail.
    writeFileSync(path.join(stateRoot, "pulse"), "in the way");
    capturePaneMock.mockResolvedValue("building\n");

    await expect(pulse()).resolves.toMatchObject({ state: "active", source: "pane" });
  });

  it("treats a missing codex sessions directory as no native signal", async () => {
    recordRun("codex");
    capturePaneMock.mockResolvedValue("compiling\n");

    await expect(pulse()).resolves.toMatchObject({ state: "active", source: "pane" });
  });

  it("uses a caller-provided probe without re-probing", async () => {
    probeMock.mockResolvedValue(okProbe(["team-1"]));

    const actual = await readPulse({
      config,
      task: "team-1",
      probe: okProbe([]),
      homeDirectory,
      now: NOW,
    });

    expect(actual).toMatchObject({ state: "gone" });
    expect(probeMock).not.toHaveBeenCalled();
  });
});
