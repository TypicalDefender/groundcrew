/**
 * Crew events — the typed things worth telling a human about. Notifiers
 * (src/lib/notifiers) consume these; the orchestrator and autopilot emit
 * them through one choke point so routing and fan-out live in one place.
 */

export type CrewEventPriority = "urgent" | "action" | "info";

export type CrewEventKind =
  | "task-stuck"
  | "awaiting-input"
  | "pr-mergeable"
  | "autopilot-exhausted"
  | "task-done"
  | "crew-paused"
  | "crew-woken";

/**
 * Default priority per kind: `urgent` needs a human now, `action` has a
 * one-click next step, `info` is ambient.
 */
export const CREW_EVENT_PRIORITY: Record<CrewEventKind, CrewEventPriority> = {
  "task-stuck": "urgent",
  "awaiting-input": "urgent",
  "autopilot-exhausted": "urgent",
  "pr-mergeable": "action",
  "task-done": "info",
  "crew-paused": "info",
  "crew-woken": "info",
};

export interface CrewEvent {
  kind: CrewEventKind;
  priority: CrewEventPriority;
  /** One-line headline, e.g. "team-1 looks stuck". */
  title: string;
  /** Short body with the next step. */
  body: string;
  /** ISO timestamp. */
  at: string;
  /** Task id, when the event concerns one task. */
  task?: string;
  /** Deep link (PR, task URL) when one exists. */
  url?: string;
}

export interface MakeCrewEventInput {
  kind: CrewEventKind;
  title: string;
  body: string;
  now?: Date;
  task?: string;
  url?: string;
}

/** Build an event with the kind's default priority and a timestamp. */
export function makeCrewEvent(input: MakeCrewEventInput): CrewEvent {
  const { kind, title, body, now = new Date(), task, url } = input;
  return {
    kind,
    priority: CREW_EVENT_PRIORITY[kind],
    title,
    body,
    at: now.toISOString(),
    ...(task === undefined ? {} : { task }),
    ...(url === undefined ? {} : { url }),
  };
}
