"use client";

import type { FleetTask } from "@clipboard-health/groundcrew";

import { collectAutopilotFeed } from "@/lib/autopilotFeed";

/** Global newest-first feed of autopilot actions across the fleet. */
export function AutopilotFeedSection({
  tasks,
}: {
  tasks: readonly FleetTask[];
}): React.ReactElement | undefined {
  const feed = collectAutopilotFeed(tasks);
  if (feed.length === 0) {
    return undefined;
  }
  return (
    <section
      className="rounded-lg border p-3"
      style={{ background: "var(--surface-card)", borderColor: "var(--border-base)" }}
      aria-label="Autopilot activity"
    >
      <h2 className="mb-2 text-sm font-bold" style={{ color: "var(--text-strong)" }}>
        Autopilot activity
      </h2>
      <ul className="space-y-1">
        {feed.map((item) => (
          <li key={`${item.task}-${item.at}-${item.kind}`} className="text-xs">
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-inactive)" }}>
              {item.task}
            </span>{" "}
            <span style={{ color: "var(--text-base)" }}>{item.detail}</span>{" "}
            <span style={{ color: "var(--text-inactive)", fontFamily: "var(--font-mono)" }}>
              {item.at}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
