"use client";

import { useEffect, useState } from "react";

import { postAction } from "@/lib/postAction";

interface CreatableSource {
  name: string;
  supportsCreate: boolean;
}

type FormState = "idle" | "submitting" | "created" | "failed";

function isCreatableSource(entry: unknown): entry is CreatableSource {
  if (typeof entry !== "object" || entry === null) {
    return false;
  }
  return (
    "name" in entry &&
    typeof entry.name === "string" &&
    "supportsCreate" in entry &&
    entry.supportsCreate === true
  );
}

/**
 * Inline draft-task form shown in the Todo column for sources that support
 * task creation. Hidden entirely when no configured source can create.
 */
export function DraftTaskForm(): React.ReactElement | undefined {
  const [sources, setSources] = useState<readonly string[]>([]);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [agent, setAgent] = useState("");
  const [repository, setRepository] = useState("");
  const [source, setSource] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/sources");
        if (!response.ok) {
          return;
        }
        const body: unknown = await response.json();
        if (cancelled || typeof body !== "object" || body === null || !("sources" in body)) {
          return;
        }
        const { sources: rawSources } = body;
        if (!Array.isArray(rawSources)) {
          return;
        }
        const list = rawSources.filter(isCreatableSource).map((entry) => entry.name);
        setSources(list);
        setSource(list[0] ?? "");
      } catch {
        // No sources panel on failure; the board still works read-only.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (sources.length === 0) {
    return undefined;
  }

  async function submit(): Promise<void> {
    setState("submitting");
    setError(undefined);
    const failure = await postAction("/api/tasks", {
      source,
      title,
      agent: agent.trim() === "" ? "any" : agent,
      ...(repository.trim() === "" ? {} : { repository: repository.trim() }),
    });
    if (failure === undefined) {
      setState("created");
      setTitle("");
      return;
    }
    setState("failed");
    setError(failure);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="w-full rounded-lg border border-dashed px-3 py-2 text-left text-xs"
        style={{ borderColor: "var(--border-strong)", color: "var(--text-muted)" }}
      >
        + Draft a task
      </button>
    );
  }

  return (
    <div
      className="rounded-lg border p-3"
      style={{ background: "var(--surface-card)", borderColor: "var(--border-base)" }}
    >
      <input
        value={title}
        onChange={(event) => {
          setTitle(event.target.value);
          setState("idle");
        }}
        placeholder="Task title"
        className="w-full rounded border p-2 text-sm"
        style={{ borderColor: "var(--border-base)", color: "var(--text-base)" }}
      />
      <div className="mt-2 flex gap-2">
        <input
          value={agent}
          onChange={(event) => {
            setAgent(event.target.value);
          }}
          placeholder="agent (any)"
          className="w-1/3 rounded border p-2 text-xs"
          style={{ borderColor: "var(--border-base)", color: "var(--text-base)" }}
        />
        <input
          value={repository}
          onChange={(event) => {
            setRepository(event.target.value);
          }}
          placeholder="repository"
          className="w-1/3 rounded border p-2 text-xs"
          style={{ borderColor: "var(--border-base)", color: "var(--text-base)" }}
        />
        {sources.length > 1 ? (
          <select
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
            }}
            className="w-1/3 rounded border p-2 text-xs"
            style={{ borderColor: "var(--border-base)", color: "var(--text-base)" }}
          >
            {sources.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : undefined}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={state === "submitting" || title.trim().length === 0}
          onClick={() => {
            void submit();
          }}
          className="rounded px-2.5 py-1 text-xs font-bold text-white disabled:cursor-not-allowed"
          style={{
            background:
              state === "submitting" || title.trim().length === 0
                ? "var(--semantic-neutral)"
                : "var(--accent-primary)",
          }}
        >
          {state === "submitting" ? "Creating…" : "Create"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
          }}
          className="rounded border px-2.5 py-1 text-xs"
          style={{ borderColor: "var(--border-base)", color: "var(--text-muted)" }}
        >
          Close
        </button>
        {state === "created" ? (
          <span className="text-xs" style={{ color: "var(--semantic-success)" }}>
            Created — it appears on the next refresh
          </span>
        ) : undefined}
        {state === "failed" ? (
          <span className="text-xs" style={{ color: "var(--semantic-danger)" }}>
            {error}
          </span>
        ) : undefined}
      </div>
    </div>
  );
}
