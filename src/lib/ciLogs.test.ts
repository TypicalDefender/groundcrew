import {
  buildCiFailureNudge,
  type CiCommandRunner,
  excerptLastLines,
  fetchFailingRunLog,
  formatCiFailureNudge,
} from "./ciLogs.ts";

const PR_URL = "https://github.com/acme/repo-a/pull/7";

function fakeRunner(responses: Record<string, string | Error>): {
  runner: CiCommandRunner;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    runner: async (command, arguments_) => {
      const key = [command, ...arguments_].join(" ");
      calls.push(key);
      const match = Object.entries(responses).find(([prefix]) => key.startsWith(prefix));
      if (match === undefined) {
        throw new Error(`unexpected command: ${key}`);
      }
      if (match[1] instanceof Error) {
        throw match[1];
      }
      return match[1];
    },
  };
}

describe(excerptLastLines, () => {
  it("keeps short logs intact and trims trailing blank lines", () => {
    expect(excerptLastLines("a\nb\nc\n\n\n", 10)).toBe("a\nb\nc");
  });

  it("keeps the tail and announces how much was truncated", () => {
    const log = ["1", "2", "3", "4", "5"].join("\n");

    expect(excerptLastLines(log, 2)).toBe("… (3 earlier lines truncated)\n4\n5");
  });

  it("normalizes CRLF logs before splitting", () => {
    expect(excerptLastLines("a\r\nb\r\nc", 2)).toBe("… (1 earlier lines truncated)\nb\nc");
  });
});

describe(formatCiFailureNudge, () => {
  it("folds the workflow name and log tail into the nudge", () => {
    const nudge = formatCiFailureNudge({
      prUrl: PR_URL,
      failingRun: { workflowName: "verify", log: "step 1 ok\nstep 2 FAILED: expected 4" },
    });

    expect(nudge).toContain(`CI is failing on your pull request (${PR_URL}).`);
    expect(nudge).toContain("Failing workflow: verify.");
    expect(nudge).toContain("step 2 FAILED: expected 4");
    expect(nudge).toContain("Please fix these failures and push an update to the same branch.");
  });

  it("falls back to the generic instruction without logs", () => {
    const missing = formatCiFailureNudge({ prUrl: PR_URL });
    const empty = formatCiFailureNudge({
      prUrl: PR_URL,
      failingRun: { workflowName: "verify", log: "   " },
    });

    for (const nudge of [missing, empty]) {
      expect(nudge).toContain("Please look at the failing checks");
      expect(nudge).not.toContain("Failing workflow");
    }
  });
});

describe(fetchFailingRunLog, () => {
  it("lists the newest failed run for the branch and pulls its failed-step logs", async () => {
    const { runner, calls } = fakeRunner({
      "gh run list": JSON.stringify([{ databaseId: 123, workflowName: "verify" }]),
      "gh run view 123 --log-failed": "boom at line 9",
    });

    const failing = await fetchFailingRunLog({
      cwd: "/work/repo-a-team-1",
      branchName: "dev-team-1",
      run: runner,
    });

    expect(failing).toStrictEqual({ workflowName: "verify", log: "boom at line 9" });
    expect(calls[0]).toContain("--branch dev-team-1 --status failure --limit 1");
  });

  it("returns undefined for no failed runs, malformed JSON, and gh failures", async () => {
    const empty = fakeRunner({ "gh run list": "[]" });
    const malformed = fakeRunner({ "gh run list": '[{"workflowName":"verify"}]' });
    const broken = fakeRunner({ "gh run list": new Error("gh: not logged in") });
    const notJson = fakeRunner({ "gh run list": "not json" });

    for (const { runner } of [empty, malformed, broken, notJson]) {
      // oxlint-disable-next-line no-await-in-loop -- sequential table of fetch failures
      const failing = await fetchFailingRunLog({
        cwd: "/work",
        branchName: "dev-team-1",
        run: runner,
      });
      expect(failing).toBeUndefined();
    }
  });

  it("defaults the workflow name when gh omits it", async () => {
    const { runner } = fakeRunner({
      "gh run list": JSON.stringify([{ databaseId: 5 }]),
      "gh run view 5 --log-failed": "x",
    });

    await expect(
      fetchFailingRunLog({ cwd: "/work", branchName: "b", run: runner }),
    ).resolves.toStrictEqual({ workflowName: "CI", log: "x" });
  });
});

describe(buildCiFailureNudge, () => {
  it("builds the full excerpt nudge end to end with a capped tail", async () => {
    const log = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join("\n");
    const { runner } = fakeRunner({
      "gh run list": JSON.stringify([{ databaseId: 9, workflowName: "tests" }]),
      "gh run view 9 --log-failed": log,
    });

    const nudge = await buildCiFailureNudge({
      prUrl: PR_URL,
      worktreeDir: "/work/repo-a-team-1",
      branchName: "dev-team-1",
      run: runner,
      maxLines: 10,
      signal: new AbortController().signal,
    });

    expect(nudge).toContain("Failing workflow: tests.");
    expect(nudge).toContain("… (70 earlier lines truncated)");
    expect(nudge).toContain("line 80");
    expect(nudge).not.toContain("line 69");
  });

  it("degrades to the generic nudge when gh cannot help", async () => {
    const { runner } = fakeRunner({ "gh run list": new Error("offline") });

    const nudge = await buildCiFailureNudge({
      prUrl: PR_URL,
      worktreeDir: "/work",
      branchName: "b",
      run: runner,
    });

    expect(nudge).toContain("Please look at the failing checks");
  });
});
