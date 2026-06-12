"use client";

import { useState } from "react";

import type { FleetTask } from "@clipboard-health/groundcrew";

import { AgentBadge, Chip, PulseDot } from "@/components/primitives";
import { canStart } from "@/lib/boardModel";
import { postAction } from "@/lib/postAction";
import { ciTone, pulseColor, reviewTone } from "@/lib/statusTone";

export function TaskCard({
  task,
  onOpen,
}: {
  task: FleetTask;
  onOpen: (task: FleetTask) => void;
}): React.ReactElement {
  const pulse = task.run?.pulse;
  const ci = task.run?.ci;
  const review = task.run?.review;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        onOpen(task);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(task);
        }
      }}
      className="block w-full cursor-pointer rounded-lg border p-3 text-left transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)] motion-reduce:transition-none"
      style={{ background: "var(--surface-card)", borderColor: "var(--border-base)" }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="truncate text-xs"
          style={{ color: "var(--text-inactive)", fontFamily: "var(--font-mono)" }}
        >
          {task.id}
        </span>
        {pulse === undefined ? undefined : (
          <PulseDot color={pulseColor(pulse)} active={pulse === "active"} label={pulse} />
        )}
      </div>

      <p
        className="mt-1 line-clamp-2 text-sm font-bold leading-snug"
        style={{ color: "var(--text-strong)" }}
      >
        {task.title ?? "Untitled task"}
      </p>

      {task.branchName === undefined ? undefined : (
        <p
          className="mt-1.5 truncate text-xs"
          style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
        >
          {task.branchName}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <AgentBadge agent={task.agent} color={task.agentColor} />
        {ci === undefined ? undefined : <Chip tone={ciTone(ci)}>ci {ci}</Chip>}
        {review === undefined || review === "none" ? undefined : (
          <Chip tone={reviewTone(review)}>{review === "pending" ? "review pending" : review}</Chip>
        )}
        {task.run?.prUrl === undefined ? undefined : (
          <span className="text-xs" style={{ color: "var(--accent-link)" }}>
            PR #{task.run.prNumber}
          </span>
        )}
      </div>

      {canStart(task) ? <StartButton task={task.id} /> : undefined}
    </div>
  );
}

type StartState = "idle" | "starting" | "failed";

function StartButton({ task }: { task: string }): React.ReactElement {
  const [state, setState] = useState<StartState>("idle");
  const [error, setError] = useState<string | undefined>();

  async function start(): Promise<void> {
    setState("starting");
    setError(undefined);
    const failure = await postAction(`/api/tasks/${encodeURIComponent(task)}/start`);
    if (failure === undefined) {
      return; // stay in "starting" — the next fleet snapshot moves the card
    }
    setState("failed");
    setError(failure);
  }

  return (
    <div className="mt-2.5">
      <button
        type="button"
        disabled={state === "starting"}
        onClick={(event) => {
          event.stopPropagation();
          void start();
        }}
        className="rounded px-2.5 py-1 text-xs font-bold text-white disabled:cursor-wait"
        style={{
          background: state === "starting" ? "var(--semantic-neutral)" : "var(--accent-primary)",
        }}
      >
        {state === "starting" ? "Starting…" : "Start"}
      </button>
      {state === "failed" ? (
        <p className="mt-1 text-xs" style={{ color: "var(--semantic-danger)" }}>
          {error}
        </p>
      ) : undefined}
    </div>
  );
}
