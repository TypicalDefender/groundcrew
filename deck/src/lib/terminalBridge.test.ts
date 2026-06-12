import {
  type BridgeClient,
  type BridgePty,
  parseClientFrame,
  TerminalBridge,
} from "@/lib/terminalBridge";

class FakePty implements BridgePty {
  public written: string[] = [];
  public resizes: [number, number][] = [];
  public killed = 0;
  private dataListener: ((data: string) => void) | undefined;
  private exitListener: (() => void) | undefined;

  public write(data: string): void {
    this.written.push(data);
  }

  public resize(cols: number, rows: number): void {
    this.resizes.push([cols, rows]);
  }

  public kill(): void {
    this.killed += 1;
  }

  public onData(listener: (data: string) => void): void {
    this.dataListener = listener;
  }

  public onExit(listener: () => void): void {
    this.exitListener = listener;
  }

  public emit(data: string): void {
    this.dataListener?.(data);
  }

  public exit(): void {
    this.exitListener?.();
  }
}

class FakeClient implements BridgeClient {
  public frames: string[] = [];
  public closed = 0;

  public send(frame: string): void {
    this.frames.push(frame);
  }

  public close(): void {
    this.closed += 1;
  }

  public last(): unknown {
    return JSON.parse(this.frames.at(-1) ?? "{}");
  }
}

interface Harness {
  bridge: TerminalBridge;
  ptys: Map<string, FakePty>;
}

function makeHarness(): Harness {
  const ptys = new Map<string, FakePty>();
  const bridge = new TerminalBridge({
    spawn: (task) => {
      const pty = new FakePty();
      ptys.set(task, pty);
      return pty;
    },
  });
  return { bridge, ptys };
}

describe(TerminalBridge, () => {
  it("makes the first client the writer and later clients read-only", () => {
    const { bridge } = makeHarness();
    const writer = new FakeClient();
    const viewer = new FakeClient();

    bridge.attach("team-1", writer);
    bridge.attach("team-1", viewer);

    expect(writer.last()).toStrictEqual({ type: "status", writer: true });
    expect(viewer.last()).toStrictEqual({ type: "status", writer: false });
  });

  it("spawns one pty per task and broadcasts its output to every client", () => {
    const { bridge, ptys } = makeHarness();
    const writer = new FakeClient();
    const viewer = new FakeClient();
    bridge.attach("team-1", writer);
    bridge.attach("team-1", viewer);

    ptys.get("team-1")?.emit("hello from the pane");

    expect(writer.last()).toStrictEqual({ type: "data", data: "hello from the pane" });
    expect(viewer.last()).toStrictEqual({ type: "data", data: "hello from the pane" });
    expect(bridge.size()).toBe(1);
  });

  it("accepts input and resize only from the writer", () => {
    const { bridge, ptys } = makeHarness();
    const writer = new FakeClient();
    const viewer = new FakeClient();
    bridge.attach("team-1", writer);
    bridge.attach("team-1", viewer);
    const pty = ptys.get("team-1");

    bridge.handleFrame("team-1", viewer, { type: "input", data: "rm -rf /" });
    bridge.handleFrame("team-1", viewer, { type: "resize", cols: 1, rows: 1 });
    bridge.handleFrame("team-1", writer, { type: "input", data: "ls" });
    bridge.handleFrame("team-1", writer, { type: "resize", cols: 120, rows: 40 });

    expect(pty?.written).toStrictEqual(["ls"]);
    expect(pty?.resizes).toStrictEqual([[120, 40]]);
  });

  it("promotes the oldest viewer when the writer detaches", () => {
    const { bridge, ptys } = makeHarness();
    const writer = new FakeClient();
    const second = new FakeClient();
    const third = new FakeClient();
    bridge.attach("team-1", writer);
    bridge.attach("team-1", second);
    bridge.attach("team-1", third);

    bridge.detach("team-1", writer);

    expect(second.last()).toStrictEqual({ type: "status", writer: true });
    bridge.handleFrame("team-1", second, { type: "input", data: "continue" });
    expect(ptys.get("team-1")?.written).toStrictEqual(["continue"]);
  });

  it("kills the pty when the last client detaches", () => {
    const { bridge, ptys } = makeHarness();
    const writer = new FakeClient();
    bridge.attach("team-1", writer);

    bridge.detach("team-1", writer);

    expect(ptys.get("team-1")?.killed).toBe(1);
    expect(bridge.size()).toBe(0);
  });

  it("notifies and closes every client when the pty exits", () => {
    const { bridge, ptys } = makeHarness();
    const writer = new FakeClient();
    const viewer = new FakeClient();
    bridge.attach("team-1", writer);
    bridge.attach("team-1", viewer);

    ptys.get("team-1")?.exit();

    expect(writer.last()).toStrictEqual({ type: "exit" });
    expect(viewer.closed).toBe(1);
    expect(bridge.size()).toBe(0);

    // A detach arriving after exit must not kill the dead pty again.
    bridge.detach("team-1", writer);
    expect(ptys.get("team-1")?.killed).toBe(0);
  });

  it("ignores frames for unknown tasks", () => {
    const { bridge } = makeHarness();
    const client = new FakeClient();

    bridge.handleFrame("ghost", client, { type: "input", data: "x" });
    bridge.detach("ghost", client);

    expect(bridge.size()).toBe(0);
  });
});

describe(parseClientFrame, () => {
  it("parses input and resize frames", () => {
    expect(parseClientFrame(String.raw`{"type":"input","data":"ls\n"}`)).toStrictEqual({
      type: "input",
      data: "ls\n",
    });
    expect(parseClientFrame('{"type":"resize","cols":100,"rows":30}')).toStrictEqual({
      type: "resize",
      cols: 100,
      rows: 30,
    });
  });

  it("rejects malformed frames", () => {
    expect(parseClientFrame("not json")).toBeUndefined();
    expect(parseClientFrame('"just a string"')).toBeUndefined();
    expect(parseClientFrame('{"type":"input"}')).toBeUndefined();
    expect(parseClientFrame('{"type":"resize","cols":"wide"}')).toBeUndefined();
    expect(parseClientFrame('{"type":"detonate"}')).toBeUndefined();
  });
});
