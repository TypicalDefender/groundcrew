"use client";

import { useState } from "react";

import type { FleetTask } from "@clipboard-health/groundcrew";

import { TaskCard } from "@/components/taskCard";
import { TaskDrawer } from "@/components/taskDrawer";
import { BOARD_COLUMNS, bucketTasks } from "@/lib/boardModel";
import { useFleet } from "@/lib/useFleet";

function ColumnShell({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="mb-2 flex items-baseline gap-2 px-1">
        <h2 className="text-sm font-bold" style={{ color: "var(--text-strong)" }}>
          {title}
        </h2>
        <span className="text-xs" style={{ color: "var(--text-inactive)" }}>
          {count}
        </span>
      </div>
      <div
        className="flex flex-1 flex-col gap-2 rounded-lg p-2"
        style={{ background: "var(--surface-muted)" }}
      >
        {children}
      </div>
    </div>
  );
}

function EmptyColumn(): React.ReactElement {
  return (
    <p className="px-2 py-6 text-center text-xs" style={{ color: "var(--text-inactive)" }}>
      Nothing here
    </p>
  );
}

function LoadingBoard(): React.ReactElement {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Loading board">
      {BOARD_COLUMNS.map((column) => (
        <div key={column} className="flex flex-col gap-2">
          <div
            className="h-4 w-24 animate-pulse rounded motion-reduce:animate-none"
            style={{ background: "var(--surface-muted)" }}
          />
          <div
            className="h-28 animate-pulse rounded-lg motion-reduce:animate-none"
            style={{ background: "var(--surface-muted)" }}
          />
        </div>
      ))}
    </div>
  );
}

export function Board(): React.ReactElement {
  const { snapshot, degraded } = useFleet();
  const [openTask, setOpenTask] = useState<FleetTask | undefined>();

  if (snapshot === undefined) {
    return <LoadingBoard />;
  }

  const buckets = bucketTasks(snapshot.tasks);
  // Keep the open drawer in sync with the latest snapshot of the same task.
  const drawerTask =
    openTask === undefined
      ? undefined
      : (snapshot.tasks.find((task) => task.id === openTask.id) ?? openTask);

  return (
    <div className="space-y-5">
      {degraded ? (
        <p
          className="rounded border px-3 py-2 text-sm"
          style={{
            background: "#EF6C000F",
            borderColor: "var(--border-error-tint)",
            color: "var(--semantic-pending)",
          }}
        >
          Live updates interrupted — reconnecting…
        </p>
      ) : undefined}

      {snapshot.board.kind === "unavailable" ? (
        <p
          className="rounded border px-3 py-2 text-sm"
          style={{
            background: "var(--surface-muted)",
            borderColor: "var(--border-base)",
            color: "var(--text-muted)",
          }}
        >
          Task source unavailable: {snapshot.board.reason} — showing local state only.
        </p>
      ) : undefined}

      {buckets.needsYou.length > 0 ? (
        <section
          className="rounded-lg border p-3"
          style={{ background: "#EF6C000F", borderColor: "#EF6C0033" }}
          aria-label="Needs you"
        >
          <h2 className="mb-2 text-sm font-bold" style={{ color: "var(--semantic-pending)" }}>
            Needs you · {buckets.needsYou.length}
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {buckets.needsYou.map((task) => (
              <TaskCard key={task.id} task={task} onOpen={setOpenTask} />
            ))}
          </div>
        </section>
      ) : undefined}

      {snapshot.tasks.length === 0 ? (
        <div
          className="rounded-lg border p-10 text-center"
          style={{ background: "var(--surface-card)", borderColor: "var(--border-base)" }}
        >
          <p className="text-sm font-bold" style={{ color: "var(--text-strong)" }}>
            The fleet is empty
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Queue a task in your source and run{" "}
            <span style={{ fontFamily: "var(--font-mono)" }}>crew run</span> — it will appear here
            live.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {BOARD_COLUMNS.map((column) => {
            const tasks = buckets.columns[column];
            return (
              <ColumnShell key={column} title={column} count={tasks.length}>
                {tasks.length === 0 ? (
                  <EmptyColumn />
                ) : (
                  tasks.map((task) => <TaskCard key={task.id} task={task} onOpen={setOpenTask} />)
                )}
              </ColumnShell>
            );
          })}
        </div>
      )}

      {drawerTask === undefined ? undefined : (
        <TaskDrawer
          task={drawerTask}
          onClose={() => {
            setOpenTask(undefined);
          }}
        />
      )}
    </div>
  );
}
