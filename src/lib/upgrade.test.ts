import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import {
  compareVersions,
  composeNudgeMessage,
  type ComputeUpgradeNudgeOptions,
  computeUpgradeNudge,
  defaultUpgradeCheckCachePath,
  fetchLatestVersion,
  normalizeRegistry,
  parseVersion,
  primeUpgradeCheckCache,
  readUpgradeCheckCache,
  type UpgradeCheckCacheEntry,
  writeUpgradeCheckCache,
} from "./upgrade.ts";

type FetcherFn = ComputeUpgradeNudgeOptions["fetcher"];

const DEFAULT_REGISTRY = "https://registry.npmjs.org";

function cacheEntry(overrides: Partial<UpgradeCheckCacheEntry> = {}): UpgradeCheckCacheEntry {
  return {
    latest: "3.1.8",
    fetchedAt: 1000,
    registry: DEFAULT_REGISTRY,
    ...overrides,
  };
}

function writeCacheEntry(path: string, overrides: Partial<UpgradeCheckCacheEntry> = {}): void {
  writeUpgradeCheckCache(path, cacheEntry(overrides));
}

function readCacheEntry(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe(parseVersion, () => {
  it("parses major.minor.patch", () => {
    expect(parseVersion("3.1.8")).toStrictEqual({ major: 3, minor: 1, patch: 8 });
  });

  it.each(["3.1", "3.x.8", "", "01.2.3", "3.1.8-beta.1", "3.1.8+sha.abc"])(
    "throws on invalid version %s",
    (version) => {
      expect(() => parseVersion(version)).toThrow(/invalid version/i);
    },
  );
});

describe(compareVersions, () => {
  it.each([
    ["3.1.8", "3.1.8", 0],
    ["3.1.7", "3.1.8", -1],
    ["3.1.9", "3.1.8", 1],
    ["3.2.0", "3.1.99", 1],
    ["4.0.0", "3.99.99", 1],
  ])("compares %s to %s", (left, right, expected) => {
    expect(compareVersions(left, right)).toBe(expected);
  });
});

describe(fetchLatestVersion, () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the version field from the registry", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ version: "3.1.8" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchLatestVersion("@scope/pkg", { timeoutMs: 1000 });

    expect(result).toBe("3.1.8");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://registry.npmjs.org/@scope%2Fpkg/latest",
      expect.any(Object),
    );
  });

  it("uses a custom registry", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ version: "1.0.0" }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchLatestVersion("@scope/pkg", {
      timeoutMs: 1000,
      registry: "https://npm.mirror.example/",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://npm.mirror.example/@scope%2Fpkg/latest",
      expect.any(Object),
    );
  });

  it("throws when the registry cannot return a usable version", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response("nope", { status: 503 }))
        .mockResolvedValueOnce(Response.json(null))
        .mockResolvedValueOnce(Response.json(5))
        .mockResolvedValueOnce(Response.json({ name: "x" }))
        .mockResolvedValueOnce(Response.json({ version: 123 }))
        .mockResolvedValueOnce(Response.json({ version: "3.1.8-beta.1" })),
    );

    await expect(fetchLatestVersion("@scope/pkg", { timeoutMs: 1000 })).rejects.toThrow(/503/);
    await expect(fetchLatestVersion("@scope/pkg", { timeoutMs: 1000 })).rejects.toThrow(/version/);
    await expect(fetchLatestVersion("@scope/pkg", { timeoutMs: 1000 })).rejects.toThrow(/version/);
    await expect(fetchLatestVersion("@scope/pkg", { timeoutMs: 1000 })).rejects.toThrow(/version/);
    await expect(fetchLatestVersion("@scope/pkg", { timeoutMs: 1000 })).rejects.toThrow(/version/);
    await expect(fetchLatestVersion("@scope/pkg", { timeoutMs: 1000 })).rejects.toThrow(
      /invalid version/,
    );
  });

  it("wraps fetch failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND")),
    );

    await expect(fetchLatestVersion("@scope/pkg", { timeoutMs: 1000 })).rejects.toThrow(
      /registry request failed/,
    );
  });

  it("times out the registry request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(
        async (_input, init) =>
          await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new Error("aborted"));
            });
          }),
      ),
    );

    await expect(fetchLatestVersion("@scope/pkg", { timeoutMs: 5 })).rejects.toThrow(
      /registry request failed/,
    );
  });
});

describe(normalizeRegistry, () => {
  it.each([
    [undefined, DEFAULT_REGISTRY],
    ["https://npm.mirror.example/", "https://npm.mirror.example"],
  ])("normalizes %s", (input: string | undefined, expected) => {
    expect(normalizeRegistry(input)).toBe(expected);
  });
});

describe(defaultUpgradeCheckCachePath, () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses XDG_CACHE_HOME when set", () => {
    vi.stubEnv("XDG_CACHE_HOME", "/var/cache/example");

    expect(defaultUpgradeCheckCachePath()).toBe("/var/cache/example/groundcrew/upgrade-check.json");
  });

  it.each([undefined, ""])("falls back to ~/.cache when XDG_CACHE_HOME is %s", (value) => {
    vi.stubEnv("XDG_CACHE_HOME", value);

    expect(defaultUpgradeCheckCachePath()).toBe(
      join(homedir(), ".cache", "groundcrew", "upgrade-check.json"),
    );
  });
});

describe("upgrade-check cache", () => {
  let cacheDir: string;
  let cachePath: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "groundcrew-upgrade-cache-"));
    cachePath = join(cacheDir, "upgrade-check.json");
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("reads missing, invalid, fresh, stale, and wrong-registry cache entries", () => {
    expect(readUpgradeCheckCache(cachePath, { now: () => 0, ttlMs: 1000 })).toStrictEqual({
      kind: "missing",
    });

    for (const content of [
      "{not json",
      "null",
      "5",
      JSON.stringify({ latest: "3.1.8" }),
      JSON.stringify({ latest: 5, fetchedAt: 1000, registry: DEFAULT_REGISTRY }),
      JSON.stringify({ latest: "3.1.8", fetchedAt: "soon", registry: DEFAULT_REGISTRY }),
      JSON.stringify({ latest: "3.1.8", fetchedAt: 1000, registry: 5 }),
      JSON.stringify({ latest: "3.1.8-beta.1", fetchedAt: 1000, registry: DEFAULT_REGISTRY }),
      JSON.stringify({ latest: "9.9.9", fetchedAt: 1000, registry: "https://mirror.example" }),
    ]) {
      writeFileSync(cachePath, content);
      expect(readUpgradeCheckCache(cachePath, { now: () => 1500, ttlMs: 1000 })).toStrictEqual({
        kind: "missing",
      });
    }

    writeCacheEntry(cachePath);
    expect(readUpgradeCheckCache(cachePath, { now: () => 1500, ttlMs: 1000 })).toStrictEqual({
      kind: "fresh",
      entry: cacheEntry(),
    });
    expect(readUpgradeCheckCache(cachePath, { now: () => 5000, ttlMs: 1000 })).toStrictEqual({
      kind: "stale",
      entry: cacheEntry(),
    });
  });

  it("writes cache entries", () => {
    const nestedPath = join(cacheDir, "nested", "upgrade-check.json");
    const entry = cacheEntry({ latest: "3.2.0", fetchedAt: 42 });

    writeUpgradeCheckCache(nestedPath, entry);

    expect(readCacheEntry(nestedPath)).toStrictEqual(entry);
  });

  it("primes cache entries best-effort", () => {
    primeUpgradeCheckCache({
      path: cachePath,
      latest: "3.2.0",
      now: () => 42,
      registry: "https://npm.mirror.example/",
    });
    expect(readCacheEntry(cachePath)).toStrictEqual({
      latest: "3.2.0",
      fetchedAt: 42,
      registry: "https://npm.mirror.example",
    });

    const blocker = join(cacheDir, "blocker");
    writeFileSync(blocker, "");
    expect(() => {
      primeUpgradeCheckCache({
        path: join(blocker, "cache.json"),
        latest: "3.2.0",
        now: () => 42,
      });
    }).not.toThrow();
  });
});

describe(composeNudgeMessage, () => {
  it.each([
    ["3.1.8", "3.2.0", "[crew] 3.2.0 available — run `crew upgrade` (you have 3.1.8)"],
    ["3.1.8", "3.1.8", undefined],
    ["3.2.0", "3.1.8", undefined],
  ])("composes a nudge from %s to %s", (current, latest, expected) => {
    expect(composeNudgeMessage(current, latest)).toBe(expected);
  });
});

describe(computeUpgradeNudge, () => {
  let cacheDir: string;
  let cachePath: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "groundcrew-upgrade-nudge-"));
    cachePath = join(cacheDir, "upgrade-check.json");
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  function baseOptions(overrides: {
    currentVersion: string;
    fetcher?: FetcherFn;
    noUpgradeCheck?: boolean;
    now?: () => number;
  }): ComputeUpgradeNudgeOptions {
    return {
      currentVersion: overrides.currentVersion,
      packageName: "@clipboard-health/groundcrew",
      cachePath,
      ttlMs: 6 * 60 * 60 * 1000,
      fetchTimeoutMs: 300,
      noUpgradeCheck: overrides.noUpgradeCheck ?? false,
      now: overrides.now ?? (() => 1_000_000),
      fetcher:
        overrides.fetcher ??
        (async () => {
          throw new Error("fetcher should not have been called");
        }),
    };
  }

  it("uses a fresh cache entry and honors opt-out", async () => {
    writeCacheEntry(cachePath, { latest: "3.2.0", fetchedAt: 1_000_000 });

    await expect(computeUpgradeNudge(baseOptions({ currentVersion: "3.1.8" }))).resolves.toBe(
      "[crew] 3.2.0 available — run `crew upgrade` (you have 3.1.8)",
    );
    await expect(
      computeUpgradeNudge(baseOptions({ currentVersion: "3.1.8", noUpgradeCheck: true })),
    ).resolves.toBeUndefined();
  });

  it("fetches and caches when the cache is missing or stale", async () => {
    const stale = 1_000_000 - 100 * 60 * 60 * 1000;
    writeCacheEntry(cachePath, { fetchedAt: stale });
    const fetcher = vi.fn<FetcherFn>().mockResolvedValue("3.2.0");

    const result = await computeUpgradeNudge(
      baseOptions({ currentVersion: "3.1.8", fetcher, now: () => 1_000_000 }),
    );

    expect(result).toBe("[crew] 3.2.0 available — run `crew upgrade` (you have 3.1.8)");
    expect(fetcher).toHaveBeenCalledWith("@clipboard-health/groundcrew", {
      timeoutMs: 300,
      registry: undefined,
    });
    expect(readCacheEntry(cachePath)).toStrictEqual({
      latest: "3.2.0",
      fetchedAt: 1_000_000,
      registry: DEFAULT_REGISTRY,
    });
  });

  it("falls back to stale cache when fetch fails", async () => {
    const stale = 1_000_000 - 100 * 60 * 60 * 1000;
    writeCacheEntry(cachePath, { latest: "3.2.0", fetchedAt: stale });
    const fetcher = vi.fn<FetcherFn>().mockRejectedValueOnce(new Error("network down"));

    const result = await computeUpgradeNudge(baseOptions({ currentVersion: "3.1.8", fetcher }));

    expect(result).toBe("[crew] 3.2.0 available — run `crew upgrade` (you have 3.1.8)");
    expect(readCacheEntry(cachePath)).toStrictEqual({
      latest: "3.2.0",
      fetchedAt: stale,
      registry: DEFAULT_REGISTRY,
    });
  });

  it("returns undefined when fetch fails without cache", async () => {
    const fetcher = vi.fn<FetcherFn>().mockRejectedValueOnce(new Error("network down"));

    const result = await computeUpgradeNudge(baseOptions({ currentVersion: "3.1.8", fetcher }));

    expect(result).toBeUndefined();
    expect(() => readCacheEntry(cachePath)).toThrow(/ENOENT/);
  });

  it("forwards registry and still returns when cache write fails", async () => {
    const blocker = join(cacheDir, "blocker");
    writeFileSync(blocker, "");
    const fetcher = vi.fn<FetcherFn>().mockResolvedValueOnce("3.2.0");

    const result = await computeUpgradeNudge({
      ...baseOptions({ currentVersion: "3.1.8", fetcher }),
      cachePath: join(blocker, "cache.json"),
      registry: "https://registry.npmjs.org/",
    });

    expect(result).toBe("[crew] 3.2.0 available — run `crew upgrade` (you have 3.1.8)");
    expect(fetcher).toHaveBeenCalledWith("@clipboard-health/groundcrew", {
      timeoutMs: 300,
      registry: "https://registry.npmjs.org/",
    });
  });
});
