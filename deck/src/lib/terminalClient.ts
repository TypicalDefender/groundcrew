/**
 * Client-side helpers for the live terminal pane: frame codecs, the
 * websocket URL, and the connection phase machine. All pure, so the React
 * component stays a thin shell around xterm and a socket.
 */

import { parseFramePayload } from "@/lib/framePayload";

export type ServerFrame =
  | { type: "data"; data: string }
  | { type: "status"; writer: boolean }
  | { type: "exit" }
  | { type: "error"; message: string };

export type TerminalPhase =
  | { kind: "connecting" }
  | { kind: "live"; writer: boolean }
  | { kind: "exited" }
  | { kind: "disconnected" }
  | { kind: "unsupported"; message: string };

/** Parse one raw server message; undefined for anything malformed. */
export function parseServerFrame(raw: string): ServerFrame | undefined {
  const parsed = parseFramePayload(raw);
  if (parsed === undefined) {
    return undefined;
  }
  if (parsed.type === "data" && "data" in parsed && typeof parsed.data === "string") {
    return { type: "data", data: parsed.data };
  }
  if (parsed.type === "status" && "writer" in parsed && typeof parsed.writer === "boolean") {
    return { type: "status", writer: parsed.writer };
  }
  if (parsed.type === "exit") {
    return { type: "exit" };
  }
  if (parsed.type === "error" && "message" in parsed && typeof parsed.message === "string") {
    return { type: "error", message: parsed.message };
  }
  return undefined;
}

/** Phase transition for one server frame; data frames leave the phase alone. */
export function phaseForFrame(frame: ServerFrame): TerminalPhase | undefined {
  if (frame.type === "status") {
    return { kind: "live", writer: frame.writer };
  }
  if (frame.type === "exit") {
    return { kind: "exited" };
  }
  if (frame.type === "error") {
    return { kind: "unsupported", message: frame.message };
  }
  return undefined;
}

/**
 * A dropped socket only matters while the terminal was (about to go) live;
 * exit and unsupported outcomes already explain themselves.
 */
export function phaseAfterSocketClose(previous: TerminalPhase): TerminalPhase {
  return previous.kind === "connecting" || previous.kind === "live"
    ? { kind: "disconnected" }
    : previous;
}

/** The terminal server listens next to the deck server, one port up. */
export function terminalSocketUrl(
  location: { protocol: string; hostname: string; port: string },
  task: string,
): string {
  const secure = location.protocol === "https:";
  let port = Number(location.port);
  if (location.port === "") {
    port = secure ? 443 : 80;
  }
  const scheme = secure ? "wss" : "ws";
  return `${scheme}://${location.hostname}:${port + 1}/terminal?task=${encodeURIComponent(task)}`;
}

export function inputFrame(data: string): string {
  return JSON.stringify({ type: "input", data });
}

export function resizeFrame(cols: number, rows: number): string {
  return JSON.stringify({ type: "resize", cols, rows });
}

export interface PhaseBadge {
  label: string;
  color: string;
}

const BADGES: Record<Exclude<TerminalPhase["kind"], "live">, PhaseBadge> = {
  connecting: { label: "connecting…", color: "var(--semantic-pending)" },
  exited: { label: "exited", color: "var(--text-inactive)" },
  disconnected: { label: "disconnected", color: "var(--semantic-warning)" },
  unsupported: { label: "snapshot", color: "var(--text-muted)" },
};

/** Status chip text + color for the pane header. */
export function phaseBadge(phase: TerminalPhase): PhaseBadge {
  if (phase.kind === "live") {
    return phase.writer
      ? { label: "live", color: "var(--semantic-success)" }
      : { label: "read-only", color: "var(--accent-primary)" };
  }
  return BADGES[phase.kind];
}
