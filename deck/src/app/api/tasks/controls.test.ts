import {
  cleanupWorkspace,
  findPullRequestsForBranch,
  interruptWorkspace,
  loadConfig,
  mergePullRequest,
  readRunState,
  resumeWorkspace,
  setupWorkspaceCli,
} from "@clipboard-health/groundcrew";

import { POST as cleanup } from "./[task]/cleanup/route";
import { POST as merge } from "./[task]/merge/route";
import { POST as resume } from "./[task]/resume/route";
import { POST as start } from "./[task]/start/route";
import { POST as stop } from "./[task]/stop/route";

vi.mock("@clipboard-health/groundcrew", () => ({
  isPlainTaskId: (task: string) => /^[\da-z]+(?:-[\da-z]+)*$/.test(task),
  loadConfig: vi.fn<() => Promise<unknown>>(),
  setupWorkspaceCli: vi.fn<() => Promise<void>>(),
  interruptWorkspace: vi.fn<() => Promise<void>>(),
  resumeWorkspace: vi.fn<() => Promise<void>>(),
  cleanupWorkspace: vi.fn<() => Promise<void>>(),
  readRunState: vi.fn<() => unknown>(),
  findPullRequestsForBranch: vi.fn<() => Promise<unknown[]>>(),
  mergePullRequest: vi.fn<() => Promise<unknown>>(),
}));

const loadConfigMock = vi.mocked(loadConfig);
const startMock = vi.mocked(setupWorkspaceCli);
const stopMock = vi.mocked(interruptWorkspace);
const resumeMock = vi.mocked(resumeWorkspace);
const cleanupMock = vi.mocked(cleanupWorkspace);
const readRunStateMock = vi.mocked(readRunState);
const findPullRequestsMock = vi.mocked(findPullRequestsForBranch);
const mergePullRequestMock = vi.mocked(mergePullRequest);

interface RouteContext {
  params: Promise<{ task: string }>;
}

function contextFor(task: string): RouteContext {
  return { params: Promise.resolve({ task }) };
}

function request(body?: unknown): Request {
  return new Request("http://deck.local/api", {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const partialConfig = { deck: { port: 4400, pollIntervalMilliseconds: 5000 } };
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the routes only pass config through
const CONFIG = partialConfig as unknown as Awaited<ReturnType<typeof loadConfig>>;

type Summary = Awaited<ReturnType<typeof findPullRequestsForBranch>>[number];
type Run = ReturnType<typeof readRunState>;

function mergeableSummary(): Summary {
  return {
    url: "https://github.com/x/y/pull/9",
    number: 9,
    state: "open",
    title: "t",
    headRefOid: "a",
    ci: "passing",
    review: "approved",
    unresolvedComments: 0,
  };
}

function recordedRun(): Run {
  return {
    task: "team-1",
    repository: "repo-a",
    agent: "claude",
    worktreeDir: "/w",
    branchName: "b",
    workspaceName: "team-1",
    state: "running",
    createdAt: "2026-06-13T00:00:00.000Z",
    updatedAt: "2026-06-13T00:00:00.000Z",
    resumeCount: 0,
    prUrl: "https://github.com/x/y/pull/9",
    prNumber: 9,
  };
}

describe("control routes", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("rejects invalid task ids before touching any command", async () => {
    const response = await start(request(), contextFor("Not A Task!"));

    expect(response.status).toBe(400);
    expect(startMock).not.toHaveBeenCalled();
  });

  it("starts a task through the crew start path", async () => {
    startMock.mockResolvedValue();

    const response = await start(request(), contextFor("TEAM-1"));

    expect(response.status).toBe(200);
    expect(startMock).toHaveBeenCalledWith("team-1");
  });

  it("maps command failures to a structured 409", async () => {
    startMock.mockRejectedValue(new Error("Task team-1 not found across configured sources."));

    const response = await start(request(), contextFor("team-1"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toStrictEqual({
      ok: false,
      error: "Task team-1 not found across configured sources.",
    });
  });

  it("stops a task with a deck-attributed reason", async () => {
    loadConfigMock.mockResolvedValue(CONFIG);
    stopMock.mockResolvedValue();

    const response = await stop(request(), contextFor("team-1"));

    expect(response.status).toBe(200);
    expect(stopMock).toHaveBeenCalledWith(CONFIG, {
      task: "team-1",
      reason: "stopped from the deck",
    });
  });

  it("resumes a task", async () => {
    loadConfigMock.mockResolvedValue(CONFIG);
    resumeMock.mockResolvedValue();

    const response = await resume(request(), contextFor("team-1"));

    expect(response.status).toBe(200);
    expect(resumeMock).toHaveBeenCalledWith(CONFIG, { task: "team-1" });
  });

  it("cleans up without force by default and with force when the body asks", async () => {
    loadConfigMock.mockResolvedValue(CONFIG);
    cleanupMock.mockResolvedValue();

    await cleanup(request(), contextFor("team-1"));
    expect(cleanupMock).toHaveBeenLastCalledWith(CONFIG, { task: "team-1", force: false });

    await cleanup(request({ force: true }), contextFor("team-1"));
    expect(cleanupMock).toHaveBeenLastCalledWith(CONFIG, { task: "team-1", force: true });
  });
});

describe("merge route", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("answers 404 when the task has no recorded pull request", async () => {
    loadConfigMock.mockResolvedValue(CONFIG);
    // oxlint-disable-next-line unicorn/no-useless-undefined -- the route reads "no run state recorded"
    readRunStateMock.mockReturnValue(undefined);

    const response = await merge(request(), contextFor("team-1"));

    expect(response.status).toBe(404);
    expect(mergePullRequestMock).not.toHaveBeenCalled();
  });

  it("refuses when the fresh lookup cannot confirm the recorded PR", async () => {
    loadConfigMock.mockResolvedValue(CONFIG);
    readRunStateMock.mockReturnValue(recordedRun());
    findPullRequestsMock.mockResolvedValue([]);

    const response = await merge(request(), contextFor("team-1"));

    expect(response.status).toBe(409);
    expect(mergePullRequestMock).not.toHaveBeenCalled();
  });

  it("relays a refused merge as 409 with the guard's reason", async () => {
    loadConfigMock.mockResolvedValue(CONFIG);
    readRunStateMock.mockReturnValue(recordedRun());
    findPullRequestsMock.mockResolvedValue([{ ...mergeableSummary(), ci: "failing" }]);
    mergePullRequestMock.mockResolvedValue({
      outcome: "refused",
      reason: "PR #9 is not mergeable: state=open, review=approved, ci=failing",
    });

    const response = await merge(request(), contextFor("team-1"));

    expect(response.status).toBe(409);
    const body: unknown = await response.json();
    expect(JSON.stringify(body)).toContain("not mergeable");
  });

  it("merges a confirmed mergeable PR against its worktree", async () => {
    loadConfigMock.mockResolvedValue(CONFIG);
    readRunStateMock.mockReturnValue(recordedRun());
    findPullRequestsMock.mockResolvedValue([mergeableSummary()]);
    mergePullRequestMock.mockResolvedValue({ outcome: "merged" });

    const response = await merge(request(), contextFor("team-1"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ ok: true, merged: 9 });
    expect(mergePullRequestMock).toHaveBeenCalledWith({
      cwd: "/w",
      pullRequest: mergeableSummary(),
    });
  });
});
