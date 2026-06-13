/**
 * `crew attach <task>` — drop the operator into the task's live terminal
 * workspace. Resolves the configured backend's attach command (tmux and
 * zellij have one; cmux is its own app) and execs it with the terminal
 * inherited, so the command behaves exactly like typing it yourself.
 */

import { runCommand } from "../lib/commandRunner.ts";
import { loadConfig, type ResolvedConfig } from "../lib/config.ts";
import { isPlainTaskId } from "../lib/taskId.ts";
import { workspaces } from "../lib/workspaces.ts";

const ATTACH_USAGE = "crew attach <task>";

export interface AttachDeps {
  /** Runs the attach command with stdio inherited. */
  exec: (command: string, arguments_: readonly string[]) => void;
}

const DEFAULT_ATTACH_DEPS: AttachDeps = {
  /* v8 ignore next 3 @preserve -- thin adapter over runCommand's inherit mode; tests inject a recorder */
  exec: (command, arguments_) => {
    runCommand(command, arguments_, { stdio: "inherit", timeoutMs: 0 });
  },
};

export async function attachWorkspace(
  config: ResolvedConfig,
  task: string,
  deps: AttachDeps = DEFAULT_ATTACH_DEPS,
): Promise<void> {
  const probe = await workspaces.probe(config);
  if (probe.kind === "unavailable") {
    throw new Error("Could not list workspaces; is the configured backend installed?");
  }
  if (!probe.names.has(task)) {
    throw new Error(
      `No live workspace for ${task}. Start it with \`crew start ${task}\` or reopen it with \`crew resume ${task}\`.`,
    );
  }
  const hint = await workspaces.accessHint(config, task);
  if (hint === undefined) {
    throw new Error(
      `The configured workspace backend has no shell attach command for ${task}; open it in its own app instead.`,
    );
  }
  const [command, ...arguments_] = hint.command.split(" ");
  /* v8 ignore next 3 @preserve -- every built-in hint is a non-empty command string */
  if (command === undefined || command === "") {
    throw new Error(`Unusable attach hint: ${hint.command}`);
  }
  deps.exec(command, arguments_);
}

export async function attachCli(argv: string[]): Promise<void> {
  const [task, ...extras] = argv;
  if (task === undefined || extras.length > 0) {
    throw new Error(`Usage: ${ATTACH_USAGE}`);
  }
  const normalized = task.toLowerCase();
  if (!isPlainTaskId(normalized)) {
    throw new Error(`crew attach: invalid task id: ${task}`);
  }
  const config = await loadConfig();
  await attachWorkspace(config, normalized);
}
