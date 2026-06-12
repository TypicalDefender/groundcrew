/**
 * WebSocket terminal server: one upgrade path (`/terminal?task=<id>`) that
 * attaches the browser to the task's tmux window through a pty. Started
 * once per server process from Next's instrumentation hook, listening on
 * deck.port + 1 so the Next server itself stays untouched.
 *
 * Only the tmux backend supports attach; other workspace kinds get a
 * structured error frame and the UI falls back to pane snapshots.
 */

import { execSync } from "node:child_process";

import { loadConfig } from "@clipboard-health/groundcrew";
import { spawn as spawnPty } from "node-pty";
import { WebSocketServer, type WebSocket } from "ws";

import { restoreOperatorDirectory } from "@/lib/crewEnvironment";
import {
  type BridgeClient,
  type BridgePty,
  parseClientFrame,
  TerminalBridge,
} from "@/lib/terminalBridge";

const TMUX_SESSION = "groundcrew";

function hasTmux(): boolean {
  try {
    execSync("tmux -V", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function spawnAttachPty(task: string): BridgePty {
  const pty = spawnPty("tmux", ["attach", "-t", `${TMUX_SESSION}:${task}`], {
    name: "xterm-256color",
    cols: 120,
    rows: 32,
    cwd: process.cwd(),
    // oxlint-disable-next-line node/no-process-env -- the attach pty needs the full host environment
    env: { ...process.env },
  });
  return {
    write: (data) => {
      pty.write(data);
    },
    resize: (cols, rows) => {
      pty.resize(cols, rows);
    },
    kill: () => {
      pty.kill();
    },
    onData: (listener) => {
      pty.onData(listener);
    },
    onExit: (listener) => {
      pty.onExit(listener);
    },
  };
}

declare global {
  // Survives Next dev-mode hot reloads so we never double-bind the port.
  var groundcrewTerminalServer: WebSocketServer | undefined;
}

export async function startTerminalServer(): Promise<void> {
  if (globalThis.groundcrewTerminalServer !== undefined) {
    return;
  }
  restoreOperatorDirectory();
  const config = await loadConfig();
  const port = config.deck.port + 1;
  const bridge = new TerminalBridge({ spawn: spawnAttachPty });
  const server = new WebSocketServer({ port });
  globalThis.groundcrewTerminalServer = server;

  server.on("connection", (socket: WebSocket, request) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const task = url.searchParams.get("task");
    if (task === null || task.length === 0 || !/^[\da-z]+(?:-[\da-z]+)*$/.test(task)) {
      socket.send(JSON.stringify({ type: "error", message: "invalid task" }));
      socket.close();
      return;
    }
    if (!hasTmux()) {
      socket.send(JSON.stringify({ type: "error", message: "live attach needs the tmux backend" }));
      socket.close();
      return;
    }
    const client: BridgeClient = {
      send: (frame) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(frame);
        }
      },
      close: () => {
        socket.close();
      },
    };
    bridge.attach(task, client);
    socket.on("message", (raw) => {
      // ws RawData is Buffer | ArrayBuffer | Buffer[]; normalize via Buffer.
      const frame = parseClientFrame(Buffer.isBuffer(raw) ? raw.toString("utf8") : "");
      if (frame !== undefined) {
        bridge.handleFrame(task, client, frame);
      }
    });
    socket.on("close", () => {
      bridge.detach(task, client);
    });
  });
}
