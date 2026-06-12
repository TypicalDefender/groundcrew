"use client";

import "@xterm/xterm/css/xterm.css";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  inputFrame,
  parseServerFrame,
  phaseAfterSocketClose,
  phaseBadge,
  phaseForFrame,
  resizeFrame,
  terminalSocketUrl,
  type TerminalPhase,
} from "@/lib/terminalClient";

/** Dark pane on the light board, matching the navigation gradient. */
const TERMINAL_THEME = {
  background: "#00101F",
  foreground: "#D7E3F4",
  cursor: "#1890FF",
  cursorAccent: "#00101F",
  selectionBackground: "#1890FF55",
};

const TERMINAL_FONT = '"SF Mono", ui-monospace, "Cascadia Mono", Menlo, monospace';

/**
 * Live terminal for one task: an xterm view over the deck's websocket
 * bridge. First viewer holds the keyboard, later ones watch read-only.
 * When the workspace backend can't stream (no tmux), the pane falls back
 * to periodic snapshots of the pane text.
 */
export function TerminalPane({ task }: { task: string }): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<TerminalPhase>({ kind: "connecting" });
  const [expanded, setExpanded] = useState(false);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    // React populates the ref before effects run; the guard narrows the type.
    const mount = containerRef.current;
    let disposed = false;
    let socket: WebSocket | undefined;
    let terminal: { dispose: () => void; write: (data: string) => void } | undefined;
    let observer: ResizeObserver | undefined;
    setPhase({ kind: "connecting" });

    async function connect(container: HTMLDivElement): Promise<void> {
      // xterm touches `self` at module scope, so it must load in the browser.
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed) {
        return;
      }
      const term = new Terminal({
        cursorBlink: true,
        fontSize: 12,
        fontFamily: TERMINAL_FONT,
        theme: TERMINAL_THEME,
        scrollback: 2000,
      });
      terminal = term;
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(container);
      fit.fit();

      const ws = new WebSocket(terminalSocketUrl(globalThis.location, task));
      socket = ws;
      ws.addEventListener("open", () => {
        // The pty spawns at a default size; align it with the fitted view.
        ws.send(resizeFrame(term.cols, term.rows));
      });
      ws.addEventListener("message", (event: MessageEvent) => {
        const frame = parseServerFrame(typeof event.data === "string" ? event.data : "");
        if (frame === undefined) {
          return;
        }
        if (frame.type === "data") {
          term.write(frame.data);
          return;
        }
        const next = phaseForFrame(frame);
        if (next !== undefined) {
          setPhase(next);
        }
      });
      ws.addEventListener("close", () => {
        setPhase(phaseAfterSocketClose);
      });
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(inputFrame(data));
        }
      });
      observer = new ResizeObserver(() => {
        fit.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(resizeFrame(term.cols, term.rows));
        }
      });
      observer.observe(container);
    }

    if (mount !== null) {
      void connect(mount);
    }

    return () => {
      disposed = true;
      observer?.disconnect();
      socket?.close();
      terminal?.dispose();
    };
  }, [task, generation]);

  const badge = phaseBadge(phase);
  const fallback = phase.kind === "unsupported";
  const canReconnect = phase.kind === "disconnected" || phase.kind === "exited";

  return (
    <div
      className={expanded ? "fixed inset-0 z-[70] flex flex-col gap-2 p-6" : "flex flex-col gap-2"}
      style={expanded ? { background: "rgba(0, 16, 31, 0.97)" } : undefined}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: badge.color }}
          aria-hidden
        />
        <span
          className="text-xs font-bold"
          aria-label="terminal status"
          style={{ color: expanded ? "#D7E3F4" : "var(--text-muted)" }}
        >
          {badge.label}
        </span>
        {expanded ? (
          <span className="text-xs" style={{ color: "#D7E3F488", fontFamily: "var(--font-mono)" }}>
            {task}
          </span>
        ) : undefined}
        <span className="flex-1" />
        {canReconnect ? (
          <PaneButton
            label="Reconnect"
            expanded={expanded}
            onClick={() => {
              setGeneration((current) => current + 1);
            }}
          />
        ) : undefined}
        {fallback ? undefined : (
          <PaneButton
            label={expanded ? "Collapse" : "Expand"}
            expanded={expanded}
            onClick={() => {
              setExpanded((current) => !current);
            }}
          />
        )}
      </div>
      <div
        ref={containerRef}
        className={`${fallback ? "hidden" : ""} ${expanded ? "min-h-0 flex-1" : "h-64"} overflow-hidden rounded p-2`}
        style={{ background: TERMINAL_THEME.background }}
        aria-label={`Terminal for ${task}`}
      />
      {fallback ? <SnapshotPane task={task} note={phase.message} /> : undefined}
    </div>
  );
}

function PaneButton({
  label,
  expanded,
  onClick,
}: {
  label: string;
  expanded: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border px-2 py-0.5 text-xs"
      style={
        expanded
          ? { borderColor: "#D7E3F455", color: "#D7E3F4" }
          : { borderColor: "var(--border-base)", color: "var(--text-muted)" }
      }
    >
      {label}
    </button>
  );
}

const SNAPSHOT_REFRESH_MILLISECONDS = 5000;

/** Read-only pane text with periodic refresh, for backends without attach. */
function SnapshotPane({ task, note }: { task: string; note: string }): React.ReactElement {
  const [content, setContent] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task)}/pane`, {
        cache: "no-store",
      });
      const body: unknown = await response.json();
      const captured =
        typeof body === "object" && body !== null && "content" in body ? body.content : undefined;
      if (response.ok && typeof captured === "string") {
        setContent(captured);
        setError(undefined);
        return;
      }
      setError("no pane snapshot available");
    } catch {
      setError("snapshot request failed");
    }
  }, [task]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, SNAPSHOT_REFRESH_MILLISECONDS);
    return () => {
      clearInterval(timer);
    };
  }, [refresh]);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {note} — showing pane snapshots instead.
      </p>
      <pre
        className="h-64 overflow-auto rounded p-2 text-xs"
        style={{
          background: TERMINAL_THEME.background,
          color: TERMINAL_THEME.foreground,
          fontFamily: TERMINAL_FONT,
        }}
        aria-label={`Pane snapshot for ${task}`}
      >
        {content ?? error ?? "capturing…"}
      </pre>
      <div className="flex">
        <button
          type="button"
          onClick={() => {
            void refresh();
          }}
          className="rounded border px-2 py-0.5 text-xs"
          style={{ borderColor: "var(--border-base)", color: "var(--text-muted)" }}
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
