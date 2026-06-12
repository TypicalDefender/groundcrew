"use client";

import { useState } from "react";

import type { FleetTask } from "@clipboard-health/groundcrew";

import { postAction } from "@/lib/postAction";

export interface ActionOutcome {
  message: string;
  tone: "success" | "error";
}

interface ActionSpec {
  key: string;
  label: string;
  /** Visible at all for this task? */
  visible: boolean;
  /** Clickable (only meaningful when visible). */
  enabled: boolean;
  /** Why the action is disabled, shown as a tooltip. */
  disabledReason?: string;
  /** Destructive actions confirm first and render in danger style. */
  destructive: boolean;
  url: string;
}

function actionsFor(task: FleetTask): ActionSpec[] {
  const id = encodeURIComponent(task.id);
  const live = task.workspace === "live";
  const mergeable = task.run?.ci === "passing" && task.run.review === "approved";
  return [
    {
      key: "stop",
      label: "Stop",
      visible: live,
      enabled: true,
      destructive: false,
      url: `/api/tasks/${id}/stop`,
    },
    {
      key: "resume",
      label: "Resume",
      visible: !live && task.run !== undefined,
      enabled: true,
      destructive: false,
      url: `/api/tasks/${id}/resume`,
    },
    {
      key: "cleanup",
      label: "Cleanup",
      visible: task.worktrees.length > 0 || task.run !== undefined,
      enabled: true,
      destructive: true,
      url: `/api/tasks/${id}/cleanup`,
    },
    {
      key: "merge",
      label: "Merge",
      visible: task.run?.prUrl !== undefined,
      enabled: mergeable,
      ...(mergeable ? {} : { disabledReason: "needs an approved review and passing CI" }),
      destructive: true,
      url: `/api/tasks/${id}/merge`,
    },
  ];
}

export function ActionBar({
  task,
  onOutcome,
}: {
  task: FleetTask;
  onOutcome: (outcome: ActionOutcome) => void;
}): React.ReactElement {
  const [busy, setBusy] = useState<string | undefined>();
  const [confirming, setConfirming] = useState<ActionSpec | undefined>();

  async function run(action: ActionSpec): Promise<void> {
    setConfirming(undefined);
    setBusy(action.key);
    const failure = await postAction(action.url);
    setBusy(undefined);
    onOutcome(
      failure === undefined
        ? { message: `${action.label} applied to ${task.id}`, tone: "success" }
        : { message: `${action.label} ${task.id}: ${failure}`, tone: "error" },
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
      {actionsFor(task)
        .filter((action) => action.visible)
        .map((action) => (
          <button
            key={action.key}
            type="button"
            disabled={!action.enabled || busy !== undefined}
            title={action.disabledReason}
            onClick={() => {
              if (action.destructive) {
                setConfirming(action);
                return;
              }
              void run(action);
            }}
            className="rounded px-3 py-1.5 text-xs font-bold disabled:cursor-not-allowed"
            style={
              action.destructive
                ? {
                    background: action.enabled ? "var(--semantic-danger)" : "var(--surface-muted)",
                    color: action.enabled ? "#FFFFFF" : "var(--text-inactive)",
                  }
                : {
                    background:
                      busy === undefined ? "var(--accent-primary)" : "var(--semantic-neutral)",
                    color: "#FFFFFF",
                  }
            }
          >
            {busy === action.key ? `${action.label}…` : action.label}
          </button>
        ))}

      {confirming === undefined ? undefined : (
        <ConfirmDialog
          label={confirming.label}
          task={task.id}
          onConfirm={() => {
            void run(confirming);
          }}
          onCancel={() => {
            setConfirming(undefined);
          }}
        />
      )}
    </div>
  );
}

function ConfirmDialog({
  label,
  task,
  onConfirm,
  onCancel,
}: {
  label: string;
  task: string;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      role="alertdialog"
      aria-label={`Confirm ${label}`}
    >
      <button
        type="button"
        aria-label="Cancel"
        className="absolute inset-0 cursor-default"
        style={{ background: "rgba(0, 0, 0, 0.35)" }}
        onClick={onCancel}
      />
      <div
        className="relative w-80 rounded-lg p-5 shadow-2xl"
        style={{ background: "var(--surface-card)" }}
      >
        <p className="text-sm font-bold" style={{ color: "var(--text-strong)" }}>
          {label} {task}?
        </p>
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          This cannot be undone from the deck.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border px-3 py-1.5 text-xs"
            style={{ borderColor: "var(--border-strong)", color: "var(--text-base)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded px-3 py-1.5 text-xs font-bold text-white"
            style={{ background: "var(--semantic-danger)" }}
          >
            {label}
          </button>
        </div>
      </div>
    </div>
  );
}
