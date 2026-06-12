/**
 * Opt-in keep-awake for long watch runs. On macOS with
 * `local.preventSleep: true`, holds `caffeinate -i -w <pid>` for the life
 * of the watch loop: `-i` blocks idle sleep, `-w` ties the assertion to
 * our pid so the hold dies with the process even if release never runs.
 * Everywhere else (other platforms, the flag off, caffeinate missing)
 * this is a quiet no-op — sleeping is the default, not an error.
 */

import { spawn } from "node:child_process";

import type { ResolvedConfig } from "./config.ts";
import { errorMessage, log } from "./util.ts";

/** The slice of a child process the keep-awake logic actually touches. */
export interface KeepAwakeProcess {
  kill: () => void;
  unref: () => void;
  on: (event: "error", listener: (error: Error) => void) => void;
}

export interface KeepAwakeHandle {
  /** True when a caffeinate hold is (or was) live. */
  engaged: boolean;
  /**
   * Idempotent; ends the hold and reports whether this call ended one.
   * Safe to call when nothing was engaged.
   */
  release: () => boolean;
}

export interface AcquireKeepAwakeInput {
  config: Pick<ResolvedConfig, "local">;
  /** Seam for tests; defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  /** Seam for tests; defaults to `process.pid`. */
  pid?: number;
  /** Seam for tests; defaults to spawning the real caffeinate. */
  spawnProcess?: (command: string, arguments_: readonly string[]) => KeepAwakeProcess;
}

const RELEASED: KeepAwakeHandle = { engaged: false, release: () => false };

/* v8 ignore next 3 @preserve -- thin adapter over node's spawn; unit tests inject fake process handles */
function spawnDetachedQuiet(command: string, arguments_: readonly string[]): KeepAwakeProcess {
  return spawn(command, [...arguments_], { stdio: "ignore" });
}

export function acquireKeepAwake(input: AcquireKeepAwakeInput): KeepAwakeHandle {
  const { config, platform = process.platform, pid = process.pid } = input;
  const spawnProcess = input.spawnProcess ?? spawnDetachedQuiet;

  if (config.local.preventSleep !== true || platform !== "darwin") {
    return RELEASED;
  }

  let child: KeepAwakeProcess;
  try {
    child = spawnProcess("caffeinate", ["-i", "-w", String(pid)]);
  } catch (error) {
    log(`Keep-awake unavailable (caffeinate failed to start): ${errorMessage(error)}`);
    return RELEASED;
  }
  child.on("error", (error) => {
    log(`Keep-awake unavailable (caffeinate failed to start): ${errorMessage(error)}`);
  });
  // The hold must never keep the crew process itself alive.
  child.unref();
  log("Keep-awake engaged: holding the machine out of idle sleep for this watch run");

  let released = false;
  return {
    engaged: true,
    release: () => {
      if (released) {
        return false;
      }
      released = true;
      try {
        child.kill();
      } catch {
        // Already gone — `-w <pid>` would have reaped it anyway.
      }
      log("Keep-awake released");
      return true;
    },
  };
}
