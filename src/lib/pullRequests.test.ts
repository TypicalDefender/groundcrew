import type { RunCommandOptions } from "./commandRunner.ts";
import {
  clearPullRequestLookupCache,
  fetchReviewComments,
  findPullRequestsForBranch,
  summarizeCheckRollup,
} from "./pullRequests.ts";

type RunCommandAsyncMock = (
  command: string,
  arguments_: readonly string[],
  options?: RunCommandOptions,
) => Promise<string>;

const runCommandMock = vi.hoisted(() => vi.fn<RunCommandAsyncMock>());

vi.mock(import("./commandRunner.ts"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- single recorder for the captured-stdio overload of runCommandAsync
    runCommandAsync: runCommandMock as unknown as typeof actual.runCommandAsync,
  };
});

const WORKTREE_HEAD_OID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const STALE_HEAD_OID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

interface RawPullRequestFixture {
  url: string;
  number: number;
  state: string;
  title: string;
  headRefOid: string;
}

function rawPullRequest(overrides: Partial<RawPullRequestFixture> = {}): RawPullRequestFixture {
  return {
    url: overrides.url ?? "https://github.com/acme/widgets/pull/42",
    number: overrides.number ?? 42,
    state: overrides.state ?? "OPEN",
    title: overrides.title ?? "Wire up auth",
    headRefOid: overrides.headRefOid ?? WORKTREE_HEAD_OID,
  };
}

function mockSuccessfulLookup(output: string, currentHeadOid = WORKTREE_HEAD_OID): void {
  runCommandMock.mockImplementation(async (command) => {
    if (command === "gh") {
      return output;
    }
    if (command === "git") {
      return currentHeadOid;
    }
    throw new Error(`unexpected command: ${command}`);
  });
}

function mockFailedGhLookup(): void {
  runCommandMock.mockImplementation(async (command) => {
    if (command === "git") {
      return WORKTREE_HEAD_OID;
    }
    throw new Error("gh: command not found");
  });
}

describe(findPullRequestsForBranch, () => {
  afterEach(() => {
    clearPullRequestLookupCache();
    vi.resetAllMocks();
    vi.useRealTimers();
  });

  it("parses gh's JSON output into typed PR summaries", async () => {
    mockSuccessfulLookup(JSON.stringify([rawPullRequest()]));

    const prs = await findPullRequestsForBranch({
      cwd: "/work/widgets-team-1",
      branchName: "feature/auth",
    });

    expect(prs).toStrictEqual([
      {
        url: "https://github.com/acme/widgets/pull/42",
        number: 42,
        state: "open",
        title: "Wire up auth",
        headRefOid: WORKTREE_HEAD_OID,
        ci: "unknown",
        review: "none",
        unresolvedComments: 0,
      },
    ]);
  });

  it("runs gh in the worktree dir and omits --repo so gh resolves the remote", async () => {
    mockSuccessfulLookup("[]");

    await findPullRequestsForBranch({
      cwd: "/work/widgets-team-1",
      branchName: "feature/auth",
    });

    expect(runCommandMock).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining([
        "pr",
        "list",
        "--head",
        "feature/auth",
        "url,number,state,title,headRefOid,statusCheckRollup,reviewDecision",
      ]),
      { cwd: "/work/widgets-team-1" },
    );
    expect(runCommandMock).toHaveBeenCalledWith("gh", expect.not.arrayContaining(["--repo"]), {
      cwd: "/work/widgets-team-1",
    });
    expect(runCommandMock).toHaveBeenCalledWith("git", ["rev-parse", "HEAD"], {
      cwd: "/work/widgets-team-1",
    });
  });

  it("normalises MERGED and CLOSED states to lowercase", async () => {
    mockSuccessfulLookup(
      JSON.stringify([
        rawPullRequest({ url: "https://x/pull/1", number: 1, state: "MERGED", title: "a" }),
        rawPullRequest({ url: "https://x/pull/2", number: 2, state: "CLOSED", title: "b" }),
      ]),
    );

    const prs = await findPullRequestsForBranch({
      cwd: "/work/widgets-team-1",
      branchName: "x",
    });

    expect(prs.map((p) => p.state)).toStrictEqual(["merged", "closed"]);
  });

  it("returns only PRs whose head matches the current worktree HEAD", async () => {
    mockSuccessfulLookup(
      JSON.stringify([
        rawPullRequest({ number: 1, state: "MERGED", headRefOid: STALE_HEAD_OID }),
        rawPullRequest({ number: 2, state: "OPEN" }),
      ]),
    );

    const prs = await findPullRequestsForBranch({
      cwd: "/work/widgets-team-1",
      branchName: "x",
    });

    expect(prs.map((p) => p.number)).toStrictEqual([2]);
  });

  it("returns empty when gh fails (not installed / not authenticated / network)", async () => {
    mockFailedGhLookup();

    const prs = await findPullRequestsForBranch({
      cwd: "/work/widgets-team-1",
      branchName: "x",
    });

    expect(prs).toStrictEqual([]);
  });

  it("returns empty when gh emits non-JSON output", async () => {
    mockSuccessfulLookup("not json at all");

    const prs = await findPullRequestsForBranch({
      cwd: "/work/widgets-team-1",
      branchName: "x",
    });

    expect(prs).toStrictEqual([]);
  });

  it("returns empty when gh emits a non-array JSON value", async () => {
    mockSuccessfulLookup("null");

    const prs = await findPullRequestsForBranch({
      cwd: "/work/widgets-team-1",
      branchName: "x",
    });

    expect(prs).toStrictEqual([]);
  });

  it("skips entries that don't match the expected PR shape", async () => {
    mockSuccessfulLookup(
      JSON.stringify([
        rawPullRequest({ url: "https://x/pull/1", number: 1, state: "OPEN", title: "valid" }),
        { url: "https://x/pull/9", number: 9, state: "OPEN", title: "missing head oid" },
        { url: 42, number: "not a number" }, // malformed; dropped silently
        null, // also dropped
      ]),
    );

    const prs = await findPullRequestsForBranch({
      cwd: "/work/widgets-team-1",
      branchName: "x",
    });

    expect(prs.map((p) => p.number)).toStrictEqual([1]);
  });

  it("forwards the AbortSignal to runCommandAsync alongside cwd when provided", async () => {
    mockSuccessfulLookup("[]");
    const { signal } = new AbortController();

    await findPullRequestsForBranch({
      cwd: "/work/widgets-team-1",
      branchName: "x",
      signal,
    });

    expect(runCommandMock).toHaveBeenCalledWith("gh", expect.any(Array), {
      cwd: "/work/widgets-team-1",
      signal,
    });
    expect(runCommandMock).toHaveBeenCalledWith("git", ["rev-parse", "HEAD"], {
      cwd: "/work/widgets-team-1",
      signal,
    });
  });

  it("forwards a lowercased unknown state value verbatim", async () => {
    mockSuccessfulLookup(JSON.stringify([rawPullRequest({ state: "DRAFT", title: "wip" })]));

    const prs = await findPullRequestsForBranch({
      cwd: "/work/widgets-team-1",
      branchName: "x",
    });

    expect(prs[0]?.state).toBe("draft");
  });
  it("derives the ci verdict from the statusCheckRollup in the same lookup", async () => {
    mockSuccessfulLookup(
      JSON.stringify([
        {
          ...rawPullRequest(),
          statusCheckRollup: [
            { name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
            { name: "test", status: "COMPLETED", conclusion: "SUCCESS" },
          ],
        },
      ]),
    );

    const prs = await findPullRequestsForBranch({
      cwd: "/work/widgets-team-1",
      branchName: "x",
    });

    expect(prs[0]?.ci).toBe("passing");
  });

  it("reports failing when any check failed, even with passing and pending checks", async () => {
    mockSuccessfulLookup(
      JSON.stringify([
        {
          ...rawPullRequest(),
          statusCheckRollup: [
            { name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
            { name: "lint", status: "IN_PROGRESS", conclusion: "" },
            { name: "test", status: "COMPLETED", conclusion: "FAILURE" },
          ],
        },
      ]),
    );

    const prs = await findPullRequestsForBranch({
      cwd: "/work/widgets-team-1",
      branchName: "x",
    });

    expect(prs[0]?.ci).toBe("failing");
  });

  it("reports pending while any check is still running or queued", async () => {
    mockSuccessfulLookup(
      JSON.stringify([
        {
          ...rawPullRequest(),
          statusCheckRollup: [
            { name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
            { name: "test", status: "QUEUED", conclusion: "" },
          ],
        },
      ]),
    );

    const prs = await findPullRequestsForBranch({
      cwd: "/work/widgets-team-1",
      branchName: "x",
    });

    expect(prs[0]?.ci).toBe("pending");
  });

  it("reports unknown when the PR has no checks or only skipped ones", async () => {
    mockSuccessfulLookup(
      JSON.stringify([
        { ...rawPullRequest({ number: 1, url: "https://x/pull/1" }), statusCheckRollup: [] },
        {
          ...rawPullRequest({ number: 2, url: "https://x/pull/2" }),
          statusCheckRollup: [
            { name: "optional", status: "COMPLETED", conclusion: "SKIPPED" },
            { name: "advisory", status: "COMPLETED", conclusion: "NEUTRAL" },
          ],
        },
        rawPullRequest({ number: 3, url: "https://x/pull/3" }),
      ]),
    );

    const prs = await findPullRequestsForBranch({
      cwd: "/work/widgets-team-1",
      branchName: "x",
    });

    expect(prs.map((pr) => pr.ci)).toStrictEqual(["unknown", "unknown", "unknown"]);
  });

  it("classifies legacy commit statuses that only carry a state field", async () => {
    mockSuccessfulLookup(
      JSON.stringify([
        {
          ...rawPullRequest(),
          statusCheckRollup: [
            null,
            "garbage",
            { name: "entry without result fields" },
            { context: "ci/legacy", state: "ERROR" },
          ],
        },
      ]),
    );

    const prs = await findPullRequestsForBranch({
      cwd: "/work/widgets-team-1",
      branchName: "x",
    });

    expect(prs[0]?.ci).toBe("failing");
  });

  it("memoizes signal-less lookups so one tick issues a single gh call per branch", async () => {
    vi.useFakeTimers();
    mockSuccessfulLookup(JSON.stringify([rawPullRequest()]));

    const first = await findPullRequestsForBranch({ cwd: "/w", branchName: "x" });
    const second = await findPullRequestsForBranch({ cwd: "/w", branchName: "x" });
    const otherBranch = await findPullRequestsForBranch({ cwd: "/w", branchName: "y" });

    expect(first).toStrictEqual(second);
    expect(otherBranch).toStrictEqual(first);
    // 3 commands per open-PR lookup (gh list + git + review threads);
    // two distinct lookups = 6 calls.
    expect(runCommandMock).toHaveBeenCalledTimes(6);

    vi.advanceTimersByTime(6000);
    await findPullRequestsForBranch({ cwd: "/w", branchName: "x" });
    expect(runCommandMock).toHaveBeenCalledTimes(9);
  });

  it("bypasses the cache when an AbortSignal is provided", async () => {
    mockSuccessfulLookup(JSON.stringify([rawPullRequest()]));
    const { signal } = new AbortController();

    await findPullRequestsForBranch({ cwd: "/w", branchName: "x", signal });
    await findPullRequestsForBranch({ cwd: "/w", branchName: "x", signal });

    expect(runCommandMock).toHaveBeenCalledTimes(6);
  });
});

describe(summarizeCheckRollup, () => {
  it("returns unknown for an empty rollup", () => {
    expect(summarizeCheckRollup([])).toBe("unknown");
  });

  it("ranks failing over pending over passing", () => {
    const passing = { conclusion: "SUCCESS" };
    const pending = { status: "IN_PROGRESS" };
    const failing = { conclusion: "TIMED_OUT" };

    expect(summarizeCheckRollup([passing])).toBe("passing");
    expect(summarizeCheckRollup([passing, pending])).toBe("pending");
    expect(summarizeCheckRollup([passing, pending, failing])).toBe("failing");
  });
});

async function mockLookupWithFailingThreads(
  command: string,
  arguments_: readonly string[],
): Promise<string> {
  if (command === "git") {
    return WORKTREE_HEAD_OID;
  }
  if (arguments_.includes("graphql")) {
    throw new Error("graphql exploded");
  }
  return JSON.stringify([rawPullRequest()]);
}

function threadsResponse(threads: unknown[]): string {
  return JSON.stringify({
    data: { repository: { pullRequest: { reviewThreads: { nodes: threads } } } },
  });
}

function thread(overrides: {
  id?: string;
  isResolved?: boolean;
  comment?: Record<string, unknown> | null;
}): unknown {
  const lead =
    overrides.comment === null
      ? []
      : [
          overrides.comment ?? {
            id: "c-1",
            body: "Please rename this",
            url: "https://github.com/acme/widgets/pull/42#discussion_r1",
            path: "src/auth.ts",
            line: 12,
            author: { login: "reviewer-1" },
          },
        ];
  return {
    id: overrides.id ?? "t-1",
    isResolved: overrides.isResolved ?? false,
    comments: { nodes: lead },
  };
}

describe("review state", () => {
  afterEach(() => {
    clearPullRequestLookupCache();
    vi.resetAllMocks();
  });

  function mockLookupWithThreads(prFixture: object, threadsJson: string): void {
    runCommandMock.mockImplementation(async (command, arguments_) => {
      if (command === "git") {
        return WORKTREE_HEAD_OID;
      }
      if (arguments_.includes("graphql")) {
        return threadsJson;
      }
      return JSON.stringify([prFixture]);
    });
  }

  it.each([
    ["APPROVED", "approved"],
    ["CHANGES_REQUESTED", "changes-requested"],
    ["REVIEW_REQUIRED", "pending"],
    ["", "none"],
    ["SOMETHING_NEW", "none"],
  ])("maps reviewDecision %s to %s", async (decision, expected) => {
    mockLookupWithThreads({ ...rawPullRequest(), reviewDecision: decision }, threadsResponse([]));

    const prs = await findPullRequestsForBranch({ cwd: "/w", branchName: "x" });

    expect(prs[0]?.review).toBe(expected);
  });

  it("treats a missing reviewDecision as none", async () => {
    mockLookupWithThreads(rawPullRequest(), threadsResponse([]));

    const prs = await findPullRequestsForBranch({ cwd: "/w", branchName: "x" });

    expect(prs[0]?.review).toBe("none");
  });

  it("counts lead comments of unresolved threads on open PRs", async () => {
    mockLookupWithThreads(
      rawPullRequest(),
      threadsResponse([
        thread({ id: "t-1" }),
        thread({ id: "t-2", isResolved: true }),
        thread({ id: "t-3", comment: null }),
        thread({ id: "t-4" }),
      ]),
    );

    const prs = await findPullRequestsForBranch({ cwd: "/w", branchName: "x" });

    expect(prs[0]?.unresolvedComments).toBe(2);
  });

  it("skips the thread lookup entirely for non-open PRs", async () => {
    mockLookupWithThreads({ ...rawPullRequest(), state: "MERGED" }, threadsResponse([thread({})]));

    const prs = await findPullRequestsForBranch({ cwd: "/w", branchName: "x" });

    expect(prs[0]?.unresolvedComments).toBe(0);
    expect(runCommandMock).not.toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["graphql"]),
      expect.anything(),
    );
  });

  it("defaults unresolvedComments to 0 when the thread fetch fails", async () => {
    runCommandMock.mockImplementation(mockLookupWithFailingThreads);

    const prs = await findPullRequestsForBranch({ cwd: "/w", branchName: "x" });

    expect(prs[0]?.unresolvedComments).toBe(0);
  });
});

describe(fetchReviewComments, () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  const PR_URL = "https://github.com/acme/widgets/pull/42";

  it("returns structured lead comments and passes owner/repo/number to gh", async () => {
    runCommandMock.mockResolvedValue(
      JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [
                  {
                    id: "t-9",
                    isResolved: false,
                    comments: {
                      nodes: [
                        {
                          id: "c-9",
                          body: "Handle the error case",
                          url: "https://github.com/acme/widgets/pull/42#discussion_r9",
                          path: "src/login.ts",
                          line: 88,
                          author: { login: "reviewer-2" },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      }),
    );

    const comments = await fetchReviewComments({ cwd: "/w", prUrl: PR_URL });

    expect(comments).toStrictEqual([
      {
        id: "c-9",
        threadId: "t-9",
        author: "reviewer-2",
        body: "Handle the error case",
        url: "https://github.com/acme/widgets/pull/42#discussion_r9",
        path: "src/login.ts",
        line: 88,
      },
    ]);
    expect(runCommandMock).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining([
        "api",
        "graphql",
        "-f",
        "owner=acme",
        "-f",
        "name=widgets",
        "-F",
        "number=42",
      ]),
      { cwd: "/w" },
    );
  });

  it("labels comments from deleted accounts as unknown and omits absent path/line", async () => {
    runCommandMock.mockResolvedValue(
      JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [
                  {
                    id: "t-1",
                    isResolved: false,
                    comments: {
                      nodes: [{ id: "c-1", body: "x", url: "https://u", author: null }],
                    },
                  },
                ],
              },
            },
          },
        },
      }),
    );

    const comments = await fetchReviewComments({ cwd: "/w", prUrl: PR_URL });

    expect(comments).toStrictEqual([
      { id: "c-1", threadId: "t-1", author: "unknown", body: "x", url: "https://u" },
    ]);
  });

  it("drops malformed threads and comments rather than failing", async () => {
    runCommandMock.mockResolvedValue(
      JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [
                  null,
                  "garbage",
                  { id: 42, isResolved: false },
                  { id: "t-no-comments", isResolved: false },
                  { id: "t-2", isResolved: false, comments: { nodes: [{ id: "c", body: 7 }] } },
                ],
              },
            },
          },
        },
      }),
    );

    await expect(fetchReviewComments({ cwd: "/w", prUrl: PR_URL })).resolves.toStrictEqual([]);
  });

  it("returns empty for a URL that is not a GitHub PR", async () => {
    await expect(
      fetchReviewComments({ cwd: "/w", prUrl: "https://example.com/not-a-pr" }),
    ).resolves.toStrictEqual([]);
    expect(runCommandMock).not.toHaveBeenCalled();
  });

  it("returns empty when gh fails or emits non-JSON", async () => {
    runCommandMock.mockRejectedValueOnce(new Error("gh down"));
    await expect(fetchReviewComments({ cwd: "/w", prUrl: PR_URL })).resolves.toStrictEqual([]);

    runCommandMock.mockResolvedValueOnce("not json");
    await expect(fetchReviewComments({ cwd: "/w", prUrl: PR_URL })).resolves.toStrictEqual([]);
  });

  it("forwards the abort signal", async () => {
    runCommandMock.mockResolvedValue("{}");
    const { signal } = new AbortController();

    await fetchReviewComments({ cwd: "/w", prUrl: PR_URL, signal });

    expect(runCommandMock).toHaveBeenCalledWith("gh", expect.any(Array), { cwd: "/w", signal });
  });
});
