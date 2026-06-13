"use client";

import { useEffect, useState } from "react";

import type { PortfolioEntry, PortfolioSnapshot } from "@clipboard-health/groundcrew";

import { AgentBadge, Chip, PulseDot } from "@/components/primitives";
import { columnFor } from "@/lib/boardModel";
import { pulseColor } from "@/lib/statusTone";

const REFRESH_MILLISECONDS = 10_000;

/** Every registered crew config's fleet, grouped per config. */
export function PortfolioView(): React.ReactElement {
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | undefined>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function refresh(): Promise<void> {
      try {
        const response = await fetch("/api/portfolio", { cache: "no-store" });
        const parsed: unknown = await response.json();
        if (!cancelled && response.ok) {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- our own route's payload
          setSnapshot(parsed as PortfolioSnapshot);
          setFailed(false);
        }
      } catch {
        if (!cancelled) {
          setFailed(true);
        }
      }
    }
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, REFRESH_MILLISECONDS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (snapshot === undefined) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        {failed ? "Could not load the portfolio." : "Collecting fleets…"}
      </p>
    );
  }
  if (snapshot.entries.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        No crews registered yet — run{" "}
        <span style={{ fontFamily: "var(--font-mono)" }}>crew run</span> or{" "}
        <span style={{ fontFamily: "var(--font-mono)" }}>crew deck</span> in a project first.
      </p>
    );
  }
  return (
    <div className="space-y-5">
      {snapshot.entries.map((entry) => (
        <ConfigSection key={entry.path} entry={entry} />
      ))}
    </div>
  );
}

function ConfigSection({ entry }: { entry: PortfolioEntry }): React.ReactElement {
  return (
    <section
      className="rounded-lg border p-4"
      style={{ background: "var(--surface-card)", borderColor: "var(--border-base)" }}
      aria-label={`Crew ${entry.name}`}
    >
      <div className="flex items-baseline gap-3">
        <h2 className="text-sm font-bold" style={{ color: "var(--text-strong)" }}>
          {entry.name}
        </h2>
        <span
          className="min-w-0 truncate text-xs"
          style={{ color: "var(--text-inactive)", fontFamily: "var(--font-mono)" }}
        >
          {entry.path}
        </span>
      </div>
      {entry.error === undefined ? undefined : (
        <p className="mt-2 text-xs" style={{ color: "var(--semantic-danger)" }}>
          {entry.error}
        </p>
      )}
      {entry.snapshot === undefined ? undefined : (
        <ul className="mt-3 space-y-1.5">
          {entry.snapshot.tasks.map((task) => (
            <li key={task.id} className="flex items-center gap-2 text-sm">
              <span
                className="w-44 shrink-0 truncate text-xs"
                style={{ fontFamily: "var(--font-mono)", color: "var(--text-inactive)" }}
              >
                {task.id}
              </span>
              <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text-base)" }}>
                {task.title ?? "Untitled task"}
              </span>
              {task.run?.pulse === undefined ? undefined : (
                <PulseDot
                  color={pulseColor(task.run.pulse)}
                  active={task.run.pulse === "active"}
                  label={task.run.pulse}
                />
              )}
              <AgentBadge agent={task.agent} color={task.agentColor} />
              <Chip tone={{ background: "var(--surface-muted)", text: "var(--text-muted)" }}>
                {columnFor(task)}
              </Chip>
            </li>
          ))}
          {entry.snapshot.tasks.length === 0 ? (
            <li className="text-xs" style={{ color: "var(--text-inactive)" }}>
              No tasks.
            </li>
          ) : undefined}
        </ul>
      )}
    </section>
  );
}
