"use client";

import { useState } from "react";

import type { FleetTask } from "@clipboard-health/groundcrew";

import type { ActionOutcome } from "@/components/actionBar";
import { ChoiceMenu } from "@/components/choiceMenu";
import { postAction } from "@/lib/postAction";

const SNOOZE_CHOICES: readonly { label: string; until: string }[] = [
  { label: "1 hour", until: "1h" },
  { label: "4 hours", until: "4h" },
  { label: "1 day", until: "1d" },
];

function isSnoozed(task: FleetTask): boolean {
  const until = task.run?.snoozedUntil;
  return until !== undefined && new Date(until).getTime() > Date.now();
}

/**
 * Per-task snooze: holds the task out of dispatch until the chosen time
 * (the reviewer keeps watching its PR). Snoozed tasks show Unsnooze.
 */
export function SnoozeControl({
  task,
  onOutcome,
}: {
  task: FleetTask;
  onOutcome: (outcome: ActionOutcome) => void;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  async function send(body: Record<string, unknown>, label: string): Promise<void> {
    setMenuOpen(false);
    setBusy(true);
    const failure = await postAction(`/api/tasks/${encodeURIComponent(task.id)}/snooze`, body);
    setBusy(false);
    onOutcome(
      failure === undefined
        ? { message: `${label} ${task.id}`, tone: "success" }
        : { message: `${label} ${task.id}: ${failure}`, tone: "error" },
    );
  }

  if (isSnoozed(task)) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void send({ clear: true }, "Unsnoozed");
        }}
        className="rounded border px-3 py-1.5 text-xs font-bold disabled:cursor-not-allowed"
        style={{ borderColor: "var(--border-strong)", color: "var(--semantic-pending)" }}
      >
        {busy ? "Waking…" : "Unsnooze"}
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setMenuOpen((current) => !current);
        }}
        className="rounded border px-3 py-1.5 text-xs font-bold disabled:cursor-not-allowed"
        style={{ borderColor: "var(--border-strong)", color: "var(--text-muted)" }}
      >
        {busy ? "Snoozing…" : "Snooze"}
      </button>
      {menuOpen ? (
        <ChoiceMenu
          ariaLabel="Snooze duration"
          align="left"
          choices={SNOOZE_CHOICES.map((choice) => ({ key: choice.until, label: choice.label }))}
          onChoose={(key) => {
            const choice = SNOOZE_CHOICES.find((candidate) => candidate.until === key);
            void send({ until: key }, `Snoozed (${choice?.label ?? key})`);
          }}
        />
      ) : undefined}
    </div>
  );
}
