import type { FleetTask } from "@clipboard-health/groundcrew";

import { AgentBadge, Chip, PulseDot } from "@/components/primitives";
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
    <button
      type="button"
      onClick={() => {
        onOpen(task);
      }}
      className="block w-full rounded-lg border p-3 text-left transition-shadow hover:shadow-md motion-reduce:transition-none"
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
          <Chip tone={reviewTone(review)}>{review}</Chip>
        )}
        {task.run?.prUrl === undefined ? undefined : (
          <span className="text-xs" style={{ color: "var(--accent-link)" }}>
            PR #{task.run.prNumber}
          </span>
        )}
      </div>
    </button>
  );
}
