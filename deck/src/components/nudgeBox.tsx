"use client";

import { useState } from "react";

type SendState = "idle" | "sending" | "sent" | "failed";

/** Message box in the drawer: type a nudge, deliver it to the agent's pane. */
export function NudgeBox({ task }: { task: string }): React.ReactElement {
  const [text, setText] = useState("");
  const [state, setState] = useState<SendState>("idle");
  const [error, setError] = useState<string | undefined>();

  async function send(): Promise<void> {
    setState("sending");
    setError(undefined);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task)}/nudge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (response.ok) {
        setState("sent");
        setText("");
        return;
      }
      const body: unknown = await response.json();
      const message =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "string"
          ? body.error
          : `request failed (${response.status})`;
      setState("failed");
      setError(message);
    } catch {
      setState("failed");
      setError("network error");
    }
  }

  return (
    <div>
      <textarea
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setState("idle");
        }}
        rows={3}
        placeholder="Type a message for the agent…"
        className="w-full resize-y rounded border p-2 text-sm focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)]"
        style={{ borderColor: "var(--border-base)", color: "var(--text-base)" }}
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          disabled={state === "sending" || text.trim().length === 0}
          onClick={() => {
            void send();
          }}
          className="rounded px-3 py-1.5 text-sm font-bold text-white disabled:cursor-not-allowed"
          style={{
            background:
              state === "sending" || text.trim().length === 0
                ? "var(--semantic-neutral)"
                : "var(--accent-primary)",
          }}
        >
          {state === "sending" ? "Sending…" : "Send"}
        </button>
        {state === "sent" ? (
          <span className="text-xs" style={{ color: "var(--semantic-success)" }}>
            Delivered to the agent's pane
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
