/**
 * Pure board layout logic: which column every fleet task lands in, and
 * which tasks the "Needs You" rail lifts out for operator attention. No
 * React, no I/O — fixtures in, buckets out.
 */

import type { FleetTask } from "@clipboard-health/groundcrew";

export const BOARD_COLUMNS = ["Todo", "In Progress", "In Review", "Done"] as const;

export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export interface BoardBuckets {
  /** Tasks demanding operator attention, lifted out of their columns. */
  needsYou: FleetTask[];
  columns: Record<BoardColumn, FleetTask[]>;
}

/**
 * A todo the deck can launch: the source resolved both an agent and a
 * repository for it (the same bar the dispatcher applies).
 */
export function canStart(task: FleetTask): boolean {
  return (
    task.status === "todo" && task.issue?.agent !== undefined && task.issue.repository !== undefined
  );
}

/**
 * A task needs the operator when its agent is waiting or stuck
 * (pulse `awaiting-input`/`blocked`) or its PR went red
 * (CI `failing` or review `changes-requested`).
 */
export function needsAttention(task: FleetTask): boolean {
  const pulse = task.run?.pulse;
  if (pulse === "awaiting-input" || pulse === "blocked") {
    return true;
  }
  return task.run?.ci === "failing" || task.run?.review === "changes-requested";
}

const STATUS_COLUMNS: Partial<Record<string, BoardColumn>> = {
  todo: "Todo",
  "in-progress": "In Progress",
  "in-review": "In Review",
  done: "Done",
};

/**
 * Column for a task's canonical status. Tasks the board can't classify
 * (`other`, or local-only tasks with no board match) sit in `In Progress`
 * when something is actually running — a live workspace or a
 * running/resumed run state — and in `Todo` otherwise, so leftovers never
 * hide in `Done`.
 */
export function columnFor(task: FleetTask): BoardColumn {
  const mapped = task.status === undefined ? undefined : STATUS_COLUMNS[task.status];
  if (mapped !== undefined) {
    return mapped;
  }
  const running = task.run?.state === "running" || task.run?.state === "resumed";
  return task.workspace === "live" || running ? "In Progress" : "Todo";
}

/** Split the fleet into the rail and the four columns. */
export function bucketTasks(tasks: readonly FleetTask[]): BoardBuckets {
  const buckets: BoardBuckets = {
    needsYou: [],
    columns: { Todo: [], "In Progress": [], "In Review": [], Done: [] },
  };
  for (const task of tasks) {
    if (needsAttention(task)) {
      buckets.needsYou.push(task);
      continue;
    }
    buckets.columns[columnFor(task)].push(task);
  }
  return buckets;
}
