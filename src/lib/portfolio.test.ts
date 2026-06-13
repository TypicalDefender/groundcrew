import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  deleteEnvironmentVariable,
  setEnvironmentVariable,
  snapshotEnvironmentVariables,
} from "../testHelpers/env.ts";
import { collectPortfolioSnapshot } from "./portfolio.ts";
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

/** A real on-disk crew config with one todo-txt task. */
function writeCrew(root: string, name: string, todoLine: string): string {
  const dir = path.join(root, name);
  mkdirSync(path.join(dir, "project"), { recursive: true });
  writeFileSync(path.join(dir, "todo.txt"), `${todoLine}\n`);
  const configPath = path.join(dir, "crew.config.ts");
  writeFileSync(
    configPath,
    `export default {
  sources: [{ kind: "todo-txt", todoPath: ${JSON.stringify(path.join(dir, "todo.txt"))} }],
  workspace: { projectDir: ${JSON.stringify(path.join(dir, "project"))}, knownRepositories: ["repo-a"] },
  agents: { default: "claude", definitions: { claude: {} } },
  logging: { file: ${JSON.stringify(path.join(dir, "state", "groundcrew.log"))} },
};
`,
  );
  return configPath;
}

function restoreEnvironmentVariable(
  original: Record<string, string | undefined>,
  key: string,
): void {
  const previous = original[key];
  if (previous === undefined) {
    deleteEnvironmentVariable(key);
  } else {
    setEnvironmentVariable(key, previous);
  }
}

describe(collectPortfolioSnapshot, () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "groundcrew-portfolio-"));
    probeMock.mockResolvedValue({ kind: "ok", names: new Set<string>() });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("aggregates every registered config and isolates broken ones", async () => {
    const acme = writeCrew(root, "acme", "Ship checkout id:AC-1 repo:repo-a status:todo");
    const zebra = writeCrew(root, "zebra", "Fix search id:ZB-1 repo:repo-a status:in-progress");

    const portfolio = await collectPortfolioSnapshot({
      signal: new AbortController().signal,
      configs: [
        { path: acme, name: "acme" },
        { path: zebra, name: "zebra" },
        { path: path.join(root, "ghost", "crew.config.ts"), name: "ghost" },
      ],
    });

    expect(portfolio.entries).toHaveLength(3);
    expect(portfolio.entries[0]?.snapshot?.tasks.map((task) => task.id)).toStrictEqual(["ac-1"]);
    expect(portfolio.entries[1]?.snapshot?.tasks.map((task) => task.id)).toStrictEqual(["zb-1"]);
    expect(portfolio.entries[2]?.snapshot).toBeUndefined();
    expect(portfolio.entries[2]?.error).toContain("config not found");
    expect(Date.parse(portfolio.collectedAt)).not.toBeNaN();

    // And without a signal: the other side of the optional-signal spread.
    const unsignaled = await collectPortfolioSnapshot({ configs: [{ path: acme, name: "acme" }] });
    expect(unsignaled.entries[0]?.snapshot?.tasks).toHaveLength(1);
  });

  it("rejects a config file that does not export an object", async () => {
    const dir = path.join(root, "broken");
    mkdirSync(dir, { recursive: true });
    const configPath = path.join(dir, "crew.config.ts");
    writeFileSync(configPath, "export default 7;\n");

    const portfolio = await collectPortfolioSnapshot({
      configs: [{ path: configPath, name: "broken" }],
    });

    expect(portfolio.entries[0]?.error).toContain("must export a config object");
  });

  it("reads the (empty) registry by default", async () => {
    const original = snapshotEnvironmentVariables();
    setEnvironmentVariable("XDG_STATE_HOME", path.join(root, "xdg-state"));
    try {
      const portfolio = await collectPortfolioSnapshot();
      expect(portfolio.entries).toStrictEqual([]);
    } finally {
      restoreEnvironmentVariable(original, "XDG_STATE_HOME");
    }
  });
});
