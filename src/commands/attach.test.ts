import type * as configModule from "../lib/config.ts";
import { loadConfig, type ResolvedConfig } from "../lib/config.ts";
import { workspaces } from "../lib/workspaces.ts";
import { attachCli, attachWorkspace, type AttachDeps } from "./attach.ts";

vi.mock(import("../lib/config.ts"), async (importOriginal) => {
  const actual = await importOriginal<typeof configModule>();
  return { ...actual, loadConfig: vi.fn<typeof loadConfig>() };
});
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
const accessHintMock = vi.mocked(workspaces.accessHint);

const partialConfig = { deck: { port: 4400, pollIntervalMilliseconds: 5000 } };
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- attach only threads config through the facade
const CONFIG = partialConfig as unknown as ResolvedConfig;

function recorder(): {
  deps: AttachDeps;
  calls: { command: string; arguments_: readonly string[] }[];
} {
  const calls: { command: string; arguments_: readonly string[] }[] = [];
  return {
    calls,
    deps: {
      exec: (command, arguments_) => {
        calls.push({ command, arguments_ });
      },
    },
  };
}

describe(attachWorkspace, () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("execs the backend's attach command for a live workspace", async () => {
    probeMock.mockResolvedValue({ kind: "ok", names: new Set(["team-1"]) });
    accessHintMock.mockResolvedValue({
      kind: "attachCommand",
      command: "tmux attach -t groundcrew:team-1",
    });
    const { deps, calls } = recorder();

    await attachWorkspace(CONFIG, "team-1", deps);

    expect(calls).toStrictEqual([
      { command: "tmux", arguments_: ["attach", "-t", "groundcrew:team-1"] },
    ]);
  });

  it("refuses dead workspaces with the next command to run", async () => {
    probeMock.mockResolvedValue({ kind: "ok", names: new Set<string>() });
    const { deps, calls } = recorder();

    await expect(attachWorkspace(CONFIG, "team-1", deps)).rejects.toThrow(
      /No live workspace for team-1.*crew resume team-1/s,
    );
    expect(calls).toStrictEqual([]);
  });

  it("fails clearly when the probe is unavailable or the backend has no hint", async () => {
    probeMock.mockResolvedValue({ kind: "unavailable" });
    await expect(attachWorkspace(CONFIG, "team-1", recorder().deps)).rejects.toThrow(
      /Could not list workspaces/,
    );

    probeMock.mockResolvedValue({ kind: "ok", names: new Set(["team-1"]) });
    // oxlint-disable-next-line unicorn/no-useless-undefined -- cmux reports "no concise hint" as undefined
    accessHintMock.mockResolvedValue(undefined);
    await expect(attachWorkspace(CONFIG, "team-1", recorder().deps)).rejects.toThrow(
      /no shell attach command for team-1/,
    );
  });
});

describe(attachCli, () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads the config and surfaces attach failures from the resolved task", async () => {
    vi.mocked(loadConfig).mockResolvedValue(CONFIG);
    probeMock.mockResolvedValue({ kind: "ok", names: new Set(["team-1"]) });
    // oxlint-disable-next-line unicorn/no-useless-undefined -- cmux reports "no concise hint" as undefined
    accessHintMock.mockResolvedValue(undefined);

    await expect(attachCli(["TEAM-1"])).rejects.toThrow(/no shell attach command for team-1/);
  });

  it("validates its arguments before touching any workspace", async () => {
    await expect(attachCli([])).rejects.toThrow(/Usage: crew attach <task>/);
    await expect(attachCli(["a", "b"])).rejects.toThrow(/Usage: crew attach <task>/);
    await expect(attachCli(["Not A Task!"])).rejects.toThrow(/invalid task id: Not A Task!/);
  });
});
