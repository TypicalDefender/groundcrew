import type { FleetTask } from "@clipboard-health/groundcrew";

import { BOARD_COLUMNS, bucketTasks, canStart, columnFor, needsAttention } from "@/lib/boardModel";

function task(overrides: Partial<FleetTask> & { id: string }): FleetTask {
  return {
    status: undefined,
    issue: undefined,
    run: undefined,
    worktrees: [],
    workspace: "absent",
    agent: undefined,
    agentColor: undefined,
    branchName: undefined,
    worktreeDir: undefined,
    title: undefined,
    url: undefined,
    updatedAt: undefined,
    ...overrides,
  };
}

function run(
  overrides: Partial<NonNullable<FleetTask["run"]>> = {},
): NonNullable<FleetTask["run"]> {
  return {
    task: "t",
    repository: "repo-a",
    agent: "claude",
    worktreeDir: "/w",
    branchName: "b",
    workspaceName: "t",
    state: "running",
    createdAt: "2026-06-12T08:00:00.000Z",
    updatedAt: "2026-06-12T09:00:00.000Z",
    resumeCount: 0,
    ...overrides,
  };
}

describe(columnFor, () => {
  it.each([
    ["todo", "Todo"],
    ["in-progress", "In Progress"],
    ["in-review", "In Review"],
    ["done", "Done"],
  ] as const)("maps canonical %s to the %s column", (status, column) => {
    expect(columnFor(task({ id: "t", status }))).toBe(column);
  });

  it("places unclassified tasks by whether anything is running", () => {
    expect(columnFor(task({ id: "live", workspace: "live" }))).toBe("In Progress");
    expect(columnFor(task({ id: "running", run: run() }))).toBe("In Progress");
    expect(columnFor(task({ id: "resumed", run: run({ state: "resumed" }) }))).toBe("In Progress");
    expect(columnFor(task({ id: "dead", run: run({ state: "interrupted" }) }))).toBe("Todo");
    expect(columnFor(task({ id: "orphan" }))).toBe("Todo");
    expect(columnFor(task({ id: "other", status: "other" }))).toBe("Todo");
  });
});

describe(needsAttention, () => {
  it("lifts agents waiting on the operator or stuck", () => {
    expect(needsAttention(task({ id: "t", run: run({ pulse: "awaiting-input" }) }))).toBe(true);
    expect(needsAttention(task({ id: "t", run: run({ pulse: "blocked" }) }))).toBe(true);
    expect(needsAttention(task({ id: "t", run: run({ pulse: "active" }) }))).toBe(false);
  });

  it("lifts red pull requests", () => {
    expect(needsAttention(task({ id: "t", run: run({ ci: "failing" }) }))).toBe(true);
    expect(needsAttention(task({ id: "t", run: run({ review: "changes-requested" }) }))).toBe(true);
    expect(needsAttention(task({ id: "t", run: run({ ci: "passing", review: "approved" }) }))).toBe(
      false,
    );
  });

  it("leaves tasks with no signals alone", () => {
    expect(needsAttention(task({ id: "t" }))).toBe(false);
  });
});

describe(bucketTasks, () => {
  it("splits the fleet into the rail and the four columns exactly once each", () => {
    const fleet = [
      task({ id: "queued", status: "todo" }),
      task({ id: "working", status: "in-progress", run: run() }),
      task({ id: "reviewing", status: "in-review" }),
      task({ id: "landed", status: "done" }),
      task({ id: "stuck", status: "in-progress", run: run({ pulse: "blocked" }) }),
      task({ id: "red-ci", status: "in-review", run: run({ ci: "failing" }) }),
    ];

    const buckets = bucketTasks(fleet);

    expect(buckets.needsYou.map((entry) => entry.id)).toStrictEqual(["stuck", "red-ci"]);
    expect(buckets.columns.Todo.map((entry) => entry.id)).toStrictEqual(["queued"]);
    expect(buckets.columns["In Progress"].map((entry) => entry.id)).toStrictEqual(["working"]);
    expect(buckets.columns["In Review"].map((entry) => entry.id)).toStrictEqual(["reviewing"]);
    expect(buckets.columns.Done.map((entry) => entry.id)).toStrictEqual(["landed"]);

    const total =
      buckets.needsYou.length + BOARD_COLUMNS.reduce((n, c) => n + buckets.columns[c].length, 0);
    expect(total).toBe(fleet.length);
  });
});

function issue(
  overrides: Partial<NonNullable<FleetTask["issue"]>> = {},
): NonNullable<FleetTask["issue"]> {
  return {
    id: "todo:t",
    source: "todo",
    title: "t",
    status: "todo",
    assignee: "",
    updatedAt: "2026-06-13T00:00:00.000Z",
    repository: "repo-a",
    agent: "claude",
    url: undefined,
    ...overrides,
  };
}

describe(canStart, () => {
  it("requires a todo with a resolved agent and repository", () => {
    expect(canStart(task({ id: "t", status: "todo", issue: issue() }))).toBe(true);
    expect(canStart(task({ id: "t", status: "in-progress", issue: issue() }))).toBe(false);
    expect(canStart(task({ id: "t", status: "todo", issue: issue({ agent: undefined }) }))).toBe(
      false,
    );
    expect(
      canStart(task({ id: "t", status: "todo", issue: issue({ repository: undefined }) })),
    ).toBe(false);
    expect(canStart(task({ id: "t", status: "todo" }))).toBe(false);
  });
});
