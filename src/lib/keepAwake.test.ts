import type { ResolvedConfig } from "./config.ts";
import { acquireKeepAwake, type KeepAwakeProcess } from "./keepAwake.ts";
import { captureConsoleLog, type ConsoleCapture } from "../testHelpers/consoleCapture.ts";

class FakeProcess implements KeepAwakeProcess {
  public killed = 0;
  public unrefed = 0;
  public killError: Error | undefined;
  private errorListener: ((error: Error) => void) | undefined;

  public kill(): void {
    if (this.killError !== undefined) {
      throw this.killError;
    }
    this.killed += 1;
  }

  public unref(): void {
    this.unrefed += 1;
  }

  public on(_event: "error", listener: (error: Error) => void): void {
    this.errorListener = listener;
  }

  public emitError(error: Error): void {
    this.errorListener?.(error);
  }
}

function localConfig(preventSleep: boolean): Pick<ResolvedConfig, "local"> {
  return { local: { runner: "auto", preventSleep } };
}

describe(acquireKeepAwake, () => {
  let consoleLog: ConsoleCapture;

  beforeEach(() => {
    consoleLog = captureConsoleLog();
  });

  afterEach(() => {
    consoleLog.restore();
  });

  it("holds caffeinate tied to our pid on macOS and releases exactly once", () => {
    const spawned: { command: string; arguments_: readonly string[] }[] = [];
    const child = new FakeProcess();

    const handle = acquireKeepAwake({
      config: localConfig(true),
      platform: "darwin",
      pid: 4242,
      spawnProcess: (command, arguments_) => {
        spawned.push({ command, arguments_ });
        return child;
      },
    });

    expect(handle.engaged).toBe(true);
    expect(spawned).toStrictEqual([{ command: "caffeinate", arguments_: ["-i", "-w", "4242"] }]);
    expect(child.unrefed).toBe(1);
    expect(consoleLog.output()).toContain("Keep-awake engaged");

    expect(handle.release()).toBe(true);
    expect(handle.release()).toBe(false);

    expect(child.killed).toBe(1);
    expect(consoleLog.output()).toContain("Keep-awake released");
  });

  it("is a quiet no-op when disabled or off macOS", () => {
    const spawnProcess = vi.fn<(command: string, arguments_: readonly string[]) => FakeProcess>();

    const disabled = acquireKeepAwake({
      config: localConfig(false),
      platform: "darwin",
      spawnProcess,
    });
    const linux = acquireKeepAwake({
      config: localConfig(true),
      platform: "linux",
      spawnProcess,
    });
    expect(disabled.release()).toBe(false);
    expect(linux.release()).toBe(false);

    expect(disabled.engaged).toBe(false);
    expect(linux.engaged).toBe(false);
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(consoleLog.output()).toBe("");
  });

  it("degrades to a no-op when caffeinate cannot start", () => {
    const handle = acquireKeepAwake({
      config: localConfig(true),
      platform: "darwin",
      spawnProcess: () => {
        throw new Error("spawn caffeinate ENOENT");
      },
    });

    expect(handle.engaged).toBe(false);
    expect(consoleLog.output()).toContain("Keep-awake unavailable");
    expect(consoleLog.output()).toContain("ENOENT");
  });

  it("logs an async spawn failure and tolerates a kill on a dead child", () => {
    const child = new FakeProcess();
    const handle = acquireKeepAwake({
      config: localConfig(true),
      platform: "darwin",
      spawnProcess: () => child,
    });

    child.emitError(new Error("posix_spawnp failed"));
    expect(consoleLog.output()).toContain("posix_spawnp failed");

    child.killError = new Error("ESRCH");
    handle.release();
    expect(consoleLog.output()).toContain("Keep-awake released");
  });

  it("defaults the platform seam to the real process values", () => {
    // On darwin this exercises the real-platform path with a fake spawn;
    // elsewhere it exercises the non-darwin early return — engaged matches.
    const child = new FakeProcess();
    const handle = acquireKeepAwake({
      config: localConfig(true),
      spawnProcess: () => child,
    });

    expect(handle.engaged).toBe(process.platform === "darwin");
    handle.release();
  });
});
