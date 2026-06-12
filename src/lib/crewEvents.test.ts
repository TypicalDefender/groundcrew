import { CREW_EVENT_PRIORITY, makeCrewEvent } from "./crewEvents.ts";

describe(makeCrewEvent, () => {
  it("stamps the kind's default priority and carries optional fields", () => {
    const stuck = makeCrewEvent({
      kind: "task-stuck",
      title: "team-1 looks stuck",
      body: "Pulse unchanged for 12m.",
      now: new Date("2026-06-13T08:00:00.000Z"),
      task: "team-1",
    });

    expect(stuck).toStrictEqual({
      kind: "task-stuck",
      priority: "urgent",
      title: "team-1 looks stuck",
      body: "Pulse unchanged for 12m.",
      at: "2026-06-13T08:00:00.000Z",
      task: "team-1",
    });
  });

  it("defaults the clock and supports url-only events", () => {
    const mergeable = makeCrewEvent({
      kind: "pr-mergeable",
      title: "PR #9 is mergeable",
      body: "Approved with passing CI.",
      url: "https://github.com/acme/repo-a/pull/9",
    });

    expect(mergeable.priority).toBe("action");
    expect(mergeable.task).toBeUndefined();
    expect(mergeable.url).toBe("https://github.com/acme/repo-a/pull/9");
    expect(Number.isNaN(Date.parse(mergeable.at))).toBe(false);
  });

  it("maps every kind to a priority", () => {
    expect(CREW_EVENT_PRIORITY).toStrictEqual({
      "task-stuck": "urgent",
      "awaiting-input": "urgent",
      "autopilot-exhausted": "urgent",
      "pr-mergeable": "action",
      "task-done": "info",
      "crew-paused": "info",
      "crew-woken": "info",
    });
  });
});
