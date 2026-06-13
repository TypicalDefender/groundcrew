import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  deleteEnvironmentVariable,
  setEnvironmentVariable,
  snapshotEnvironmentVariables,
} from "../testHelpers/env.ts";
import { configRegistryPath, readConfigRegistry, registerConfig } from "./configRegistry.ts";

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

describe("config registry", () => {
  let stateRoot: string;
  let registryPath: string;

  beforeEach(() => {
    stateRoot = mkdtempSync(path.join(tmpdir(), "groundcrew-registry-"));
    registryPath = path.join(stateRoot, "configs.json");
  });

  afterEach(() => {
    rmSync(stateRoot, { recursive: true, force: true });
  });

  it("registers configs idempotently, naming them after their directory", () => {
    registerConfig({ path: "/work/acme/crew.config.ts", registryPath });
    registerConfig({ path: "/work/acme/crew.config.ts", registryPath });
    const entries = registerConfig({
      path: "/work/zebra/crew.config.ts",
      name: "zebra fleet",
      registryPath,
    });

    expect(entries).toStrictEqual([
      { path: "/work/acme/crew.config.ts", name: "acme" },
      { path: "/work/zebra/crew.config.ts", name: "zebra fleet" },
    ]);
    expect(readConfigRegistry(registryPath)).toStrictEqual(entries);
  });

  it("refreshes the name of an existing entry instead of duplicating it", () => {
    registerConfig({ path: "/work/acme/crew.config.ts", registryPath });
    const entries = registerConfig({
      path: "/work/acme/crew.config.ts",
      name: "renamed",
      registryPath,
    });

    expect(entries).toStrictEqual([{ path: "/work/acme/crew.config.ts", name: "renamed" }]);
  });

  it("reads missing or malformed registries as empty and skips bad entries", () => {
    expect(readConfigRegistry(registryPath)).toStrictEqual([]);

    writeFileSync(registryPath, "not json");
    expect(readConfigRegistry(registryPath)).toStrictEqual([]);

    writeFileSync(registryPath, JSON.stringify({ configs: "all" }));
    expect(readConfigRegistry(registryPath)).toStrictEqual([]);

    writeFileSync(
      registryPath,
      JSON.stringify({
        configs: [{ path: "/ok/crew.config.ts", name: "ok" }, { name: "no path" }, 7],
      }),
    );
    expect(readConfigRegistry(registryPath)).toStrictEqual([
      { path: "/ok/crew.config.ts", name: "ok" },
    ]);
  });

  it("survives an unwritable registry location", () => {
    const entries = registerConfig({
      path: "/work/acme/crew.config.ts",
      registryPath: "/dev/null/nope/configs.json",
    });

    expect(entries).toStrictEqual([{ path: "/work/acme/crew.config.ts", name: "acme" }]);
  });

  it("defaults to the XDG state dir for path, reads, and writes", () => {
    const original = snapshotEnvironmentVariables();
    setEnvironmentVariable("XDG_STATE_HOME", stateRoot);
    try {
      expect(configRegistryPath()).toBe(path.join(stateRoot, "groundcrew", "configs.json"));
      registerConfig({ path: "/work/acme/crew.config.ts" });
      expect(readConfigRegistry()).toStrictEqual([
        { path: "/work/acme/crew.config.ts", name: "acme" },
      ]);
    } finally {
      restoreEnvironmentVariable(original, "XDG_STATE_HOME");
    }
  });

  it("canonicalizes real paths through symlinks before deduping", () => {
    const realConfig = path.join(stateRoot, "crew.config.ts");
    writeFileSync(realConfig, "export default {};\n");

    const entries = registerConfig({ path: realConfig, registryPath });

    expect(entries[0]?.path).toBe(realpathSync(realConfig));
  });

  it("writes a stable, readable file", () => {
    registerConfig({ path: "/work/acme/crew.config.ts", registryPath });

    expect(JSON.parse(readFileSync(registryPath, "utf8"))).toStrictEqual({
      configs: [{ path: "/work/acme/crew.config.ts", name: "acme" }],
    });
  });
});
