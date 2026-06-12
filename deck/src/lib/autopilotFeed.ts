/**
 * The global autopilot feed: every task's recorded activity flattened
 * into one newest-first list for the board.
 */

import type { FleetTask } from "@clipboard-health/groundcrew";

export interface AutopilotFeedItem {
  task: string;
  at: string;
  kind: string;
  detail: string;
}

export function collectAutopilotFeed(tasks: readonly FleetTask[], limit = 8): AutopilotFeedItem[] {
  const items: AutopilotFeedItem[] = [];
  for (const task of tasks) {
    for (const event of task.run?.autopilotActivity ?? []) {
      items.push({ task: task.id, at: event.at, kind: event.kind, detail: event.detail });
    }
  }
  return items.toSorted((left, right) => right.at.localeCompare(left.at)).slice(0, limit);
}

/** How many CI nudges remain for this task, when the budget applies. */
export function ciAttemptsLeft(
  attemptsUsed: number | undefined,
  maxAttempts?: number,
): number | undefined {
  if (maxAttempts === undefined) {
    return undefined;
  }
  return Math.max(0, maxAttempts - (attemptsUsed ?? 0));
}
