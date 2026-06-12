"use client";

import { useFleet } from "@/lib/useFleet";

/** Live connection summary: proves the SSE feed end-to-end until the board lands. */
export function FleetStatus(): React.ReactElement {
  const { snapshot, degraded } = useFleet();

  if (snapshot === undefined) {
    return (
      <p className="text-sm" style={{ color: "var(--text-inactive)" }}>
        Connecting to the fleet stream…
      </p>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <span
        className="rounded px-2 py-0.5"
        style={{
          background: degraded ? "#EF6C000F" : "#2FB6900F",
          color: degraded ? "var(--semantic-pending)" : "var(--semantic-success)",
        }}
      >
        {degraded ? "reconnecting…" : "live"}
      </span>
      <span style={{ color: "var(--text-muted)" }}>
        {snapshot.tasks.length} task{snapshot.tasks.length === 1 ? "" : "s"} · board{" "}
        {snapshot.board.kind === "ok" ? "ok" : "unavailable"} · updated{" "}
        <span style={{ fontFamily: "var(--font-mono)" }}>
          {new Date(snapshot.timestamp).toLocaleTimeString()}
        </span>
      </span>
    </div>
  );
}
