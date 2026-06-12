import type { FleetTask } from "@clipboard-health/groundcrew";

import { ciAttemptsLeft, collectAutopilotFeed } from "@/lib/autopilotFeed";

function taskWithActivity(
  id: string,
  activity: { at: string; kind: "merge" | "flag-stuck"; detail: string }[],
): FleetTask {
  const partial = {
    id,
    run: { task: id, autopilotActivity: activity },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the feed only reads id and run.autopilotActivity
  return partial as unknown as FleetTask;
}

describe(collectAutopilotFeed, () => {
  it("flattens, sorts newest first across tasks, and caps the list", () => {
    const feed = collectAutopilotFeed(
      [
        taskWithActivity("team-1", [
          { at: "2026-06-13T08:02:00.000Z", kind: "merge", detail: "merged pr" },
          { at: "2026-06-13T08:00:00.000Z", kind: "flag-stuck", detail: "stuck 12m" },
        ]),
        taskWithActivity("team-2", [
          { at: "2026-06-13T08:01:00.000Z", kind: "flag-stuck", detail: "stuck 30m" },
        ]),
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- run-less tasks must be tolerated
        { id: "team-3" } as unknown as FleetTask,
      ],
      2,
    );

    expect(feed).toStrictEqual([
      { task: "team-1", at: "2026-06-13T08:02:00.000Z", kind: "merge", detail: "merged pr" },
      { task: "team-2", at: "2026-06-13T08:01:00.000Z", kind: "flag-stuck", detail: "stuck 30m" },
    ]);
  });
});

describe(ciAttemptsLeft, () => {
  it("subtracts used attempts, floors at zero, and hides when no budget applies", () => {
    expect(ciAttemptsLeft(1, 2)).toBe(1);
    expect(ciAttemptsLeft(5, 2)).toBe(0);
    expect(ciAttemptsLeft(1)).toBeUndefined();
  });
});
