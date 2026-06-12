"use client";

import { useState } from "react";

import type { PauseState } from "@clipboard-health/groundcrew";

import type { ActionOutcome } from "@/components/actionBar";
import { ChoiceMenu } from "@/components/choiceMenu";
import { postAction } from "@/lib/postAction";

const PAUSE_CHOICES: readonly { label: string; for?: string }[] = [
  { label: "30 minutes", for: "30m" },
  { label: "1 hour", for: "1h" },
  { label: "2 hours", for: "2h" },
  { label: "Until wake" },
];

function describePause(pause: PauseState): string {
  const expiry =
    pause.until === undefined ? "until woken" : `until ${new Date(pause.until).toLocaleString()}`;
  const reason = pause.reason === undefined ? "" : ` — ${pause.reason}`;
  return `Crew paused ${expiry}${reason}. New work stays queued; live agents keep running.`;
}

/**
 * Global Pause/Wake for the orchestrator. Awake: a quiet header control
 * with duration choices. Paused: an amber banner with the wake button. The
 * state itself arrives with each fleet snapshot, so every open deck agrees.
 */
export function PauseControl({
  pause,
  onOutcome,
}: {
  pause: PauseState | undefined;
  onOutcome: (outcome: ActionOutcome) => void;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  async function send(url: string, body: Record<string, unknown>, label: string): Promise<void> {
    setMenuOpen(false);
    setBusy(true);
    const failure = await postAction(url, body);
    setBusy(false);
    onOutcome(
      failure === undefined
        ? { message: label, tone: "success" }
        : { message: `${label} failed: ${failure}`, tone: "error" },
    );
  }

  if (pause !== undefined) {
    return (
      <div
        className="flex items-center gap-3 rounded-lg border px-3 py-2"
        style={{ background: "#EF6C000F", borderColor: "#EF6C0033" }}
        aria-label="Crew paused"
      >
        <span aria-hidden className="text-sm">
          ⏸
        </span>
        <p className="flex-1 text-sm" style={{ color: "var(--semantic-pending)" }}>
          {describePause(pause)}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void send("/api/wake", {}, "Crew is awake");
          }}
          className="rounded px-3 py-1.5 text-xs font-bold text-white disabled:cursor-not-allowed"
          style={{ background: busy ? "var(--semantic-neutral)" : "var(--accent-primary)" }}
        >
          {busy ? "Waking…" : "Wake crew"}
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex justify-end">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setMenuOpen((current) => !current);
        }}
        className="rounded border px-3 py-1.5 text-xs font-bold disabled:cursor-not-allowed"
        style={{ borderColor: "var(--border-strong)", color: "var(--text-muted)" }}
      >
        {busy ? "Pausing…" : "Pause crew"}
      </button>
      {menuOpen ? (
        <ChoiceMenu
          ariaLabel="Pause duration"
          align="right"
          choices={PAUSE_CHOICES.map((choice) => ({ key: choice.label, label: choice.label }))}
          onChoose={(key) => {
            const choice = PAUSE_CHOICES.find((candidate) => candidate.label === key);
            void send(
              "/api/pause",
              choice?.for === undefined ? {} : { for: choice.for },
              `Crew paused (${key.toLowerCase()})`,
            );
          }}
        />
      ) : undefined}
    </div>
  );
}
