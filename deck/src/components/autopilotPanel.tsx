"use client";

import { useState } from "react";

import type { AutopilotConfig, FleetTask } from "@clipboard-health/groundcrew";

import type { ActionOutcome } from "@/components/actionBar";
import { ciAttemptsLeft } from "@/lib/autopilotFeed";
import { postAction } from "@/lib/postAction";

/**
 * Per-task autopilot controls in the drawer: the on/off switch, the CI
 * nudge budget, and the task's recent autopilot activity.
 */
export function AutopilotPanel({
  task,
  autopilot,
  onOutcome,
}: {
  task: FleetTask;
  autopilot: AutopilotConfig | undefined;
  onOutcome: (outcome: ActionOutcome) => void;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const enabled = task.run?.autopilotEnabled !== false;
  const attemptsLeft = ciAttemptsLeft(
    task.run?.ciNudgeAttempts,
    autopilot?.ciFailure.enabled === true ? autopilot.ciFailure.maxAttempts : undefined,
  );
  const activity = (task.run?.autopilotActivity ?? []).slice(0, 5);

  async function toggle(): Promise<void> {
    setBusy(true);
    const failure = await postAction(`/api/tasks/${encodeURIComponent(task.id)}/autopilot`, {
      enabled: !enabled,
    });
    setBusy(false);
    onOutcome(
      failure === undefined
        ? { message: `Autopilot ${enabled ? "off" : "on"} for ${task.id}`, tone: "success" }
        : { message: `Autopilot toggle ${task.id}: ${failure}`, tone: "error" },
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void toggle();
          }}
          aria-label={`Turn autopilot ${enabled ? "off" : "on"}`}
          className="rounded px-3 py-1.5 text-xs font-bold text-white disabled:cursor-not-allowed"
          style={{
            background: enabled ? "var(--semantic-success)" : "var(--semantic-neutral)",
            ...(enabled ? {} : { color: "var(--text-muted)" }),
          }}
        >
          {enabled ? "Autopilot on" : "Autopilot off"}
        </button>
        {attemptsLeft === undefined ? undefined : (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            CI nudges left: {attemptsLeft}
          </span>
        )}
      </div>
      {activity.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--text-inactive)" }}>
          No autopilot actions yet.
        </p>
      ) : (
        <ul className="space-y-1" aria-label={`Autopilot activity for ${task.id}`}>
          {activity.map((event) => (
            <li key={`${event.at}-${event.kind}`} className="text-xs">
              <span style={{ color: "var(--text-base)" }}>{event.detail}</span>{" "}
              <span style={{ color: "var(--text-inactive)", fontFamily: "var(--font-mono)" }}>
                {event.at}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
