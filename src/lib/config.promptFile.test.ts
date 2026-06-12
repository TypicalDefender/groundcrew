import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  deleteEnvironmentVariable,
  setEnvironmentVariable,
  snapshotEnvironmentVariables,
} from "../testHelpers/env.ts";
import type { Config, LoadedConfig, QuietHoursConfig, ResolvedConfig } from "./config.ts";

interface ConfigModule {
  loadConfig: () => Promise<Readonly<ResolvedConfig>>;
  loadConfigWithSource: () => Promise<Readonly<LoadedConfig>>;
}

async function loadFreshConfig(): Promise<ConfigModule> {
  vi.resetModules();
  return await import("./config.ts");
}

const VALID_WORKSPACE = (projectDir: string) => ({
  projectDir,
  knownRepositories: ["repo-a"],
});

function writeConfigFile(dir: string, body: string): string {
  const configPath = path.join(dir, `config-${Math.random().toString(36).slice(2)}.ts`);
  writeFileSync(configPath, body);
  return configPath;
}

function configSource(config: Config): string {
  return `export default ${JSON.stringify(config, undefined, 2)};\n`;
}

function validConfigSource(config: Config): string {
  return configSource({
    ...config,
    agents: {
      definitions: { claude: {} },
      ...config.agents,
    },
  });
}
/** Write `config`, point GROUNDCREW_CONFIG at it, and expect loadConfig to reject. */
async function expectConfigRejection(
  temporary: string,
  config: Config,
  pattern: RegExp,
): Promise<void> {
  setEnvironmentVariable(
    "GROUNDCREW_CONFIG",
    writeConfigFile(temporary, validConfigSource(config)),
  );
  const fresh = await loadFreshConfig();
  await expect(fresh.loadConfig()).rejects.toThrow(pattern);
}

describe("loadConfig prompts.promptFile", () => {
  const originalEnvironment = snapshotEnvironmentVariables();
  const ENV_KEYS = ["GROUNDCREW_CONFIG", "HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME"] as const;
  let temporary: string;

  beforeEach(() => {
    temporary = mkdtempSync(path.join(tmpdir(), "groundcrew-config-"));
    for (const key of ENV_KEYS) {
      deleteEnvironmentVariable(key);
    }
    setEnvironmentVariable("XDG_CONFIG_HOME", path.join(temporary, "xdg-config"));
    setEnvironmentVariable("XDG_STATE_HOME", path.join(temporary, "xdg-state"));
    vi.spyOn(process, "cwd").mockReturnValue(temporary);
  });

  afterEach(() => {
    rmSync(temporary, { recursive: true, force: true });
    for (const key of ENV_KEYS) {
      const original = originalEnvironment[key];
      if (original === undefined) {
        deleteEnvironmentVariable(key);
      } else {
        setEnvironmentVariable(key, original);
      }
    }
    vi.restoreAllMocks();
  });

  it("uses an explicit inline prompts.initial when no promptFile is set", async () => {
    const configPath = writeConfigFile(
      temporary,
      validConfigSource({
        workspace: VALID_WORKSPACE(temporary),
        prompts: { initial: "Just do {{task}} now." },
      }),
    );
    setEnvironmentVariable("GROUNDCREW_CONFIG", configPath);

    const { loadConfig } = await loadFreshConfig();
    const actual = await loadConfig();

    expect(actual.prompts.initial).toBe("Just do {{task}} now.");
  });

  it("loads prompts.promptFile contents into prompts.initial", async () => {
    const promptBody = "Custom prompt for {{task}} in {{worktree}}.";
    writeFileSync(path.join(temporary, "prompt-initial.md"), promptBody);
    const configPath = writeConfigFile(
      temporary,
      validConfigSource({
        workspace: VALID_WORKSPACE(temporary),
        prompts: { promptFile: "prompt-initial.md" },
      }),
    );
    setEnvironmentVariable("GROUNDCREW_CONFIG", configPath);

    const { loadConfig } = await loadFreshConfig();
    const actual = await loadConfig();

    expect(actual.prompts.initial).toBe(promptBody);
  });

  it("accepts a promptFile whose contents have no placeholders", async () => {
    const promptBody = "Plain prompt with no placeholders.";
    writeFileSync(path.join(temporary, "prompt-initial.md"), promptBody);
    const configPath = writeConfigFile(
      temporary,
      validConfigSource({
        workspace: VALID_WORKSPACE(temporary),
        prompts: { promptFile: "prompt-initial.md" },
      }),
    );
    setEnvironmentVariable("GROUNDCREW_CONFIG", configPath);

    const { loadConfig } = await loadFreshConfig();
    const actual = await loadConfig();

    expect(actual.prompts.initial).toBe(promptBody);
  });

  it("resolves a relative prompts.promptFile against the config dir, not cwd", async () => {
    const nested = path.join(temporary, "nested");
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, "prompt-initial.md"), "Prompt from nested config dir.");
    // Decoy in cwd (mocked to `temporary`) that must NOT be picked up.
    writeFileSync(path.join(temporary, "prompt-initial.md"), "Prompt from cwd — wrong.");
    const configPath = writeConfigFile(
      nested,
      validConfigSource({
        workspace: VALID_WORKSPACE(temporary),
        prompts: { promptFile: "prompt-initial.md" },
      }),
    );
    setEnvironmentVariable("GROUNDCREW_CONFIG", configPath);

    const { loadConfig } = await loadFreshConfig();
    const actual = await loadConfig();

    expect(actual.prompts.initial).toBe("Prompt from nested config dir.");
  });

  it("expands a leading ~ in prompts.promptFile", async () => {
    const fakeHome = path.join(temporary, "home");
    mkdirSync(fakeHome, { recursive: true });
    setEnvironmentVariable("HOME", fakeHome);
    writeFileSync(path.join(fakeHome, "my-prompt.md"), "Prompt from home dir.");
    const configPath = writeConfigFile(
      temporary,
      validConfigSource({
        workspace: VALID_WORKSPACE(temporary),
        prompts: { promptFile: "~/my-prompt.md" },
      }),
    );
    setEnvironmentVariable("GROUNDCREW_CONFIG", configPath);

    const { loadConfig } = await loadFreshConfig();
    const actual = await loadConfig();

    expect(actual.prompts.initial).toBe("Prompt from home dir.");
  });

  it("reads an absolute prompts.promptFile as-is", async () => {
    const absolutePrompt = path.join(temporary, "abs-prompt.md");
    writeFileSync(absolutePrompt, "Absolute prompt body.");
    const configPath = writeConfigFile(
      temporary,
      validConfigSource({
        workspace: VALID_WORKSPACE(temporary),
        prompts: { promptFile: absolutePrompt },
      }),
    );
    setEnvironmentVariable("GROUNDCREW_CONFIG", configPath);

    const { loadConfig } = await loadFreshConfig();
    const actual = await loadConfig();

    expect(actual.prompts.initial).toBe("Absolute prompt body.");
  });

  it("rejects setting both prompts.initial and prompts.promptFile", async () => {
    writeFileSync(path.join(temporary, "prompt-initial.md"), "File prompt.");
    const configPath = writeConfigFile(
      temporary,
      validConfigSource({
        workspace: VALID_WORKSPACE(temporary),
        prompts: { initial: "Inline prompt {{task}}", promptFile: "prompt-initial.md" },
      }),
    );
    setEnvironmentVariable("GROUNDCREW_CONFIG", configPath);

    const { loadConfig } = await loadFreshConfig();

    await expect(loadConfig()).rejects.toThrow(/set either `initial` or `promptFile`, not both/);
  });

  it("fails with the resolved path when prompts.promptFile cannot be read", async () => {
    const configPath = writeConfigFile(
      temporary,
      validConfigSource({
        workspace: VALID_WORKSPACE(temporary),
        prompts: { promptFile: "does-not-exist.md" },
      }),
    );
    setEnvironmentVariable("GROUNDCREW_CONFIG", configPath);

    const { loadConfig } = await loadFreshConfig();

    await expect(loadConfig()).rejects.toThrow(
      /prompts\.promptFile could not be read at .*does-not-exist\.md/,
    );
  });

  it("rejects an empty prompts.promptFile", async () => {
    const configPath = writeConfigFile(
      temporary,
      validConfigSource({
        workspace: VALID_WORKSPACE(temporary),
        prompts: { promptFile: "" },
      }),
    );
    setEnvironmentVariable("GROUNDCREW_CONFIG", configPath);

    const { loadConfig } = await loadFreshConfig();

    await expect(loadConfig()).rejects.toThrow(/prompts\.promptFile must be a non-empty string/);
  });

  it("rejects a non-string prompts.promptFile", async () => {
    const configPath = writeConfigFile(
      temporary,
      `export default { workspace: ${JSON.stringify(
        VALID_WORKSPACE(temporary),
      )}, agents: { definitions: { claude: {} } }, prompts: { promptFile: 123 } };\n`,
    );
    setEnvironmentVariable("GROUNDCREW_CONFIG", configPath);

    const { loadConfig } = await loadFreshConfig();

    await expect(loadConfig()).rejects.toThrow(/prompts\.promptFile must be a non-empty string/);
  });

  it("validates placeholders in the loaded prompts.promptFile contents", async () => {
    writeFileSync(
      path.join(temporary, "prompt-initial.md"),
      "Work on {{task}} but also {{unknownPlaceholder}}.",
    );
    const configPath = writeConfigFile(
      temporary,
      validConfigSource({
        workspace: VALID_WORKSPACE(temporary),
        prompts: { promptFile: "prompt-initial.md" },
      }),
    );
    setEnvironmentVariable("GROUNDCREW_CONFIG", configPath);

    const { loadConfig } = await loadFreshConfig();

    await expect(loadConfig()).rejects.toThrow(/unknown placeholder "\{\{unknownPlaceholder\}\}"/);
  });

  // Orchestrator pacing + keep-awake config validation lives here for the
  // shared file-loading scaffolding (config.test.ts is at its size limit).

  it("accepts and resolves orchestrator quiet hours and the active poll interval", async () => {
    const orchestrator = {
      activePollIntervalMilliseconds: 5000,
      quietHours: { start: "23:00", end: "07:00", pollIntervalMilliseconds: 900_000 },
    };
    const configPath = writeConfigFile(
      temporary,
      validConfigSource({
        workspace: VALID_WORKSPACE(temporary),
        orchestrator,
        local: { preventSleep: true },
      }),
    );
    setEnvironmentVariable("GROUNDCREW_CONFIG", configPath);
    const { loadConfig } = await loadFreshConfig();
    await expect(loadConfig()).resolves.toMatchObject({
      orchestrator,
      local: { preventSleep: true },
    });
  });

  it("rejects malformed quiet hours, slow floors, and non-boolean preventSleep", async () => {
    await expectConfigRejection(
      temporary,
      {
        workspace: VALID_WORKSPACE(temporary),
        orchestrator: {
          quietHours: { start: "25:00", end: "07:00", pollIntervalMilliseconds: 900_000 },
        },
      },
      /orchestrator\.quietHours\.start must be a 24-hour "HH:MM" time/,
    );
    await expectConfigRejection(
      temporary,
      {
        workspace: VALID_WORKSPACE(temporary),
        orchestrator: {
          quietHours: { start: "23:00", end: "07:00", pollIntervalMilliseconds: 50 },
        },
      },
      /orchestrator\.quietHours\.pollIntervalMilliseconds must be an integer ≥ 250/,
    );
    await expectConfigRejection(
      temporary,
      {
        workspace: VALID_WORKSPACE(temporary),
        orchestrator: {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- exercising the runtime shape guard
          quietHours: "overnight" as unknown as QuietHoursConfig,
        },
      },
      /orchestrator\.quietHours must be an object like/,
    );
    await expectConfigRejection(
      temporary,
      {
        workspace: VALID_WORKSPACE(temporary),
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- exercising the runtime type guard
        local: { preventSleep: "yes" as unknown as boolean },
      },
      /local\.preventSleep must be a boolean, got "yes"/,
    );
  });
});
