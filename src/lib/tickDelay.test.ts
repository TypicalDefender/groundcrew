import type { ResolvedConfig } from "./config.ts";
import type { RunState } from "./runState.ts";
import { isWithinQuietHours, nextTickDelay } from "./tickDelay.ts";

const BASE = 120_000;
const ACTIVE = 5000;
const QUIET = 900_000;

function makeConfig(orchestrator: Partial<ResolvedConfig["orchestrator"]> = {}): ResolvedConfig {
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
      pollIntervalMilliseconds: BASE,
      sessionLimitPercentage: 85,
      ...orchestrator,
    },
    agents: {
      default: "claude",
      definitions: { claude: { cmd: "claude", color: "#fff" } },
    },
    prompts: { initial: "x" },
    workspaceKind: "auto",
    local: { runner: "auto" },
    deck: { port: 4400, pollIntervalMilliseconds: 5000 },
    logging: { file: "/tmp/groundcrew-test.log" },
  };
}

function runStateWithPulse(pulse?: RunState["pulse"]): RunState {
  return {
    task: "team-1",
    repository: "repo-a",
    agent: "claude",
    worktreeDir: "/work/repo-a-team-1",
    branchName: "dev-team-1",
    workspaceName: "team-1",
    state: "running",
    createdAt: "2026-06-13T00:00:00.000Z",
    updatedAt: "2026-06-13T00:00:00.000Z",
    resumeCount: 0,
    ...(pulse === undefined ? {} : { pulse }),
  };
}

// Local-time constructor keeps the matrix independent of the host TZ.
function localTime(hours: number, minutes: number): Date {
  return new Date(2026, 5, 13, hours, minutes);
}

const QUIET_OVERNIGHT = { start: "23:00", end: "07:00", pollIntervalMilliseconds: QUIET };
const QUIET_DAYTIME = { start: "12:00", end: "13:00", pollIntervalMilliseconds: QUIET };

describe(isWithinQuietHours, () => {
  it("treats start as inclusive and end as exclusive in a same-day window", () => {
    expect(isWithinQuietHours(localTime(11, 59), QUIET_DAYTIME)).toBe(false);
    expect(isWithinQuietHours(localTime(12, 0), QUIET_DAYTIME)).toBe(true);
    expect(isWithinQuietHours(localTime(12, 59), QUIET_DAYTIME)).toBe(true);
    expect(isWithinQuietHours(localTime(13, 0), QUIET_DAYTIME)).toBe(false);
  });

  it("wraps a window past midnight", () => {
    expect(isWithinQuietHours(localTime(22, 59), QUIET_OVERNIGHT)).toBe(false);
    expect(isWithinQuietHours(localTime(23, 0), QUIET_OVERNIGHT)).toBe(true);
    expect(isWithinQuietHours(localTime(2, 30), QUIET_OVERNIGHT)).toBe(true);
    expect(isWithinQuietHours(localTime(6, 59), QUIET_OVERNIGHT)).toBe(true);
    expect(isWithinQuietHours(localTime(7, 0), QUIET_OVERNIGHT)).toBe(false);
  });

  it("treats an empty window (start === end) as no quiet hours", () => {
    const degenerate = { start: "09:00", end: "09:00" };
    expect(isWithinQuietHours(localTime(9, 0), degenerate)).toBe(false);
    expect(isWithinQuietHours(localTime(21, 0), degenerate)).toBe(false);
  });
});

describe(nextTickDelay, () => {
  const awake = { runStates: [runStateWithPulse("active")], paused: false };
  const idleFleet = { runStates: [runStateWithPulse("idle")], paused: false };

  it("fast-ticks while any pulse is active and the fast interval is configured", () => {
    const config = makeConfig({ activePollIntervalMilliseconds: ACTIVE });

    expect(nextTickDelay(localTime(10, 0), awake, config)).toBe(ACTIVE);
    expect(nextTickDelay(localTime(10, 0), idleFleet, config)).toBe(BASE);
  });

  it("keeps the base interval for active pulses when no fast interval is configured", () => {
    expect(nextTickDelay(localTime(10, 0), awake, makeConfig())).toBe(BASE);
  });

  it("active beats quiet hours; a paused crew never fast-ticks", () => {
    const config = makeConfig({
      activePollIntervalMilliseconds: ACTIVE,
      quietHours: QUIET_OVERNIGHT,
    });

    expect(nextTickDelay(localTime(23, 30), awake, config)).toBe(ACTIVE);
    expect(nextTickDelay(localTime(23, 30), { ...awake, paused: true }, config)).toBe(QUIET);
    expect(nextTickDelay(localTime(10, 0), { ...awake, paused: true }, config)).toBe(BASE);
  });

  it("slows down inside quiet hours and returns to base outside them", () => {
    const config = makeConfig({ quietHours: QUIET_OVERNIGHT });

    expect(nextTickDelay(localTime(23, 0), idleFleet, config)).toBe(QUIET);
    expect(nextTickDelay(localTime(6, 59), idleFleet, config)).toBe(QUIET);
    expect(nextTickDelay(localTime(7, 0), idleFleet, config)).toBe(BASE);
    expect(nextTickDelay(localTime(12, 0), idleFleet, config)).toBe(BASE);
  });

  it("uses the base interval when nothing adaptive is configured", () => {
    expect(
      nextTickDelay(
        localTime(3, 0),
        { runStates: [runStateWithPulse()], paused: false },
        makeConfig(),
      ),
    ).toBe(BASE);
  });
});
