/**
 * Terminal bridge registry: one live pty per task, many viewers, exactly
 * one writer. The first client to attach gets the keyboard; later clients
 * watch read-only and the oldest viewer inherits the keyboard when the
 * writer leaves. The pty dies when the last client detaches.
 *
 * Pure coordination — the pty and the sockets hide behind tiny interfaces
 * so every rule here is unit-testable without spawning anything.
 */

import { parseFramePayload } from "@/lib/framePayload";

export interface BridgePty {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  onData: (listener: (data: string) => void) => void;
  onExit: (listener: () => void) => void;
}

export interface BridgeClient {
  send: (frame: string) => void;
  close: () => void;
}

export type ClientFrame =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

interface TaskSession {
  pty: BridgePty;
  clients: BridgeClient[];
  writer: BridgeClient | undefined;
  exited: boolean;
}

export interface TerminalBridgeOptions {
  spawn: (task: string) => BridgePty;
}

function frame(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

export class TerminalBridge {
  private readonly sessions = new Map<string, TaskSession>();
  private readonly spawn: (task: string) => BridgePty;

  public constructor(options: TerminalBridgeOptions) {
    this.spawn = options.spawn;
  }

  /** Attach a client; spawns the task's pty on first attach. */
  public attach(task: string, client: BridgeClient): void {
    const session = this.sessions.get(task) ?? this.createSession(task);
    session.clients.push(client);
    session.writer ??= client;
    client.send(frame({ type: "status", writer: session.writer === client }));
  }

  /** Handle one parsed frame from a client. Non-writers are read-only. */
  public handleFrame(task: string, client: BridgeClient, parsed: ClientFrame): void {
    const session = this.sessions.get(task);
    if (session === undefined || session.exited || session.writer !== client) {
      return;
    }
    if (parsed.type === "input") {
      session.pty.write(parsed.data);
      return;
    }
    if (Number.isInteger(parsed.cols) && Number.isInteger(parsed.rows)) {
      session.pty.resize(parsed.cols, parsed.rows);
    }
  }

  /** Detach a client; promotes the oldest viewer or kills the idle pty. */
  public detach(task: string, client: BridgeClient): void {
    const session = this.sessions.get(task);
    if (session === undefined) {
      return;
    }
    session.clients = session.clients.filter((candidate) => candidate !== client);
    if (session.clients.length === 0) {
      this.sessions.delete(task);
      if (!session.exited) {
        session.pty.kill();
      }
      return;
    }
    if (session.writer === client) {
      [session.writer] = session.clients;
      session.writer?.send(frame({ type: "status", writer: true }));
    }
  }

  /** Number of live sessions (for diagnostics and tests). */
  public size(): number {
    return this.sessions.size;
  }

  private createSession(task: string): TaskSession {
    const session: TaskSession = {
      pty: this.spawn(task),
      clients: [],
      writer: undefined,
      exited: false,
    };
    session.pty.onData((data) => {
      const payload = frame({ type: "data", data });
      for (const client of session.clients) {
        client.send(payload);
      }
    });
    session.pty.onExit(() => {
      session.exited = true;
      const payload = frame({ type: "exit" });
      for (const client of session.clients) {
        client.send(payload);
        client.close();
      }
      this.sessions.delete(task);
    });
    this.sessions.set(task, session);
    return session;
  }
}

/** Parse one raw client message; undefined for anything malformed. */
export function parseClientFrame(raw: string): ClientFrame | undefined {
  const parsed = parseFramePayload(raw);
  if (parsed === undefined) {
    return undefined;
  }
  if (parsed.type === "input" && "data" in parsed && typeof parsed.data === "string") {
    return { type: "input", data: parsed.data };
  }
  if (
    parsed.type === "resize" &&
    "cols" in parsed &&
    "rows" in parsed &&
    typeof parsed.cols === "number" &&
    typeof parsed.rows === "number"
  ) {
    return { type: "resize", cols: parsed.cols, rows: parsed.rows };
  }
  return undefined;
}
