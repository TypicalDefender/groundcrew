"use client";

import { useEffect } from "react";

import type { FleetTask } from "@clipboard-health/groundcrew";

import { AgentBadge, Chip, PulseDot } from "@/components/primitives";
import { ciTone, pulseColor, reviewTone } from "@/lib/statusTone";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="border-t px-5 py-4" style={{ borderColor: "var(--border-muted)" }}>
      <h3
        className="text-[11px] font-bold uppercase tracking-wider"
        style={{ color: "var(--text-inactive)" }}
      >
        {title}
      </h3>
      <div className="mt-2 space-y-1.5">{children}</div>
    </section>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex items-baseline gap-3 text-sm">
      <span className="w-24 shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
      <span className="min-w-0 break-all" style={{ color: "var(--text-base)" }}>
        {children}
      </span>
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }): React.ReactElement {
  return <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}>{children}</span>;
}

export function TaskDrawer({
  task,
  onClose,
}: {
  task: FleetTask;
  onClose: () => void;
}): React.ReactElement {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }
    globalThis.addEventListener("keydown", onKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const { run } = task;
  const pulse = run?.pulse;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-label={`Task ${task.id}`}>
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 cursor-default"
        style={{ background: "rgba(0, 0, 0, 0.25)" }}
        onClick={onClose}
      />
      <aside
        className="drawer-panel absolute inset-y-0 right-0 flex w-full max-w-md flex-col overflow-y-auto shadow-2xl"
        style={{ background: "var(--surface-card)" }}
      >
        <header className="flex items-start justify-between gap-3 px-5 pb-4 pt-5">
          <div className="min-w-0">
            <p
              className="text-xs"
              style={{ color: "var(--text-inactive)", fontFamily: "var(--font-mono)" }}
            >
              {task.id}
            </p>
            <h2 className="mt-0.5 text-base font-bold" style={{ color: "var(--text-strong)" }}>
              {task.title ?? "Untitled task"}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <AgentBadge agent={task.agent} color={task.agentColor} />
              {task.status === undefined ? undefined : (
                <Chip tone={{ background: "var(--surface-muted)", text: "var(--text-muted)" }}>
                  {task.status}
                </Chip>
              )}
              {pulse === undefined ? undefined : (
                <PulseDot color={pulseColor(pulse)} active={pulse === "active"} label={pulse} />
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="rounded border px-2 py-1 text-xs"
            style={{ borderColor: "var(--border-base)", color: "var(--text-muted)" }}
          >
            esc
          </button>
        </header>

        {run?.prUrl === undefined ? undefined : (
          <Section title="Pull request">
            <Row label="link">
              <a
                href={run.prUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--accent-link)" }}
              >
                #{run.prNumber}
              </a>
            </Row>
            {run.ci === undefined ? undefined : (
              <Row label="ci">
                <Chip tone={ciTone(run.ci)}>{run.ci}</Chip>
              </Row>
            )}
            {run.review === undefined ? undefined : (
              <Row label="review">
                <Chip tone={reviewTone(run.review)}>{run.review}</Chip>
              </Row>
            )}
          </Section>
        )}

        {run === undefined ? undefined : (
          <Section title="Run state">
            <Row label="state">{run.state}</Row>
            <Row label="started">
              <Mono>{run.createdAt}</Mono>
            </Row>
            <Row label="updated">
              <Mono>{run.updatedAt}</Mono>
            </Row>
            <Row label="resumes">{run.resumeCount}</Row>
            {run.reason === undefined ? undefined : <Row label="reason">{run.reason}</Row>}
            {run.pulseChangedAt === undefined ? undefined : (
              <Row label="pulse since">
                <Mono>{run.pulseChangedAt}</Mono>
              </Row>
            )}
          </Section>
        )}

        <Section title="Workspace">
          <Row label="session">{task.workspace}</Row>
          {task.branchName === undefined ? undefined : (
            <Row label="branch">
              <Mono>{task.branchName}</Mono>
            </Row>
          )}
          {task.worktreeDir === undefined ? undefined : (
            <Row label="worktree">
              <Mono>{task.worktreeDir}</Mono>
            </Row>
          )}
          {run?.repository === undefined ? undefined : <Row label="repo">{run.repository}</Row>}
        </Section>

        {task.url === undefined ? undefined : (
          <Section title="Links">
            <Row label="task">
              <a
                href={task.url}
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--accent-link)" }}
              >
                {task.url}
              </a>
            </Row>
          </Section>
        )}
      </aside>
    </div>
  );
}
