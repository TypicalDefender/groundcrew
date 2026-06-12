import {
  inputFrame,
  parseServerFrame,
  phaseAfterSocketClose,
  phaseBadge,
  phaseForFrame,
  resizeFrame,
  terminalSocketUrl,
} from "@/lib/terminalClient";

describe(parseServerFrame, () => {
  it("parses every server frame type", () => {
    expect(parseServerFrame('{"type":"data","data":"$ ls"}')).toStrictEqual({
      type: "data",
      data: "$ ls",
    });
    expect(parseServerFrame('{"type":"status","writer":true}')).toStrictEqual({
      type: "status",
      writer: true,
    });
    expect(parseServerFrame('{"type":"exit"}')).toStrictEqual({ type: "exit" });
    expect(parseServerFrame('{"type":"error","message":"no tmux"}')).toStrictEqual({
      type: "error",
      message: "no tmux",
    });
  });

  it("rejects malformed frames", () => {
    expect(parseServerFrame("not json")).toBeUndefined();
    expect(parseServerFrame("null")).toBeUndefined();
    expect(parseServerFrame('"plain string"')).toBeUndefined();
    expect(parseServerFrame('{"type":"data"}')).toBeUndefined();
    expect(parseServerFrame('{"type":"status","writer":"yes"}')).toBeUndefined();
    expect(parseServerFrame('{"type":"error"}')).toBeUndefined();
    expect(parseServerFrame('{"type":"reboot"}')).toBeUndefined();
  });
});

describe(phaseForFrame, () => {
  it("maps control frames to phases and leaves data frames alone", () => {
    expect(phaseForFrame({ type: "status", writer: true })).toStrictEqual({
      kind: "live",
      writer: true,
    });
    expect(phaseForFrame({ type: "status", writer: false })).toStrictEqual({
      kind: "live",
      writer: false,
    });
    expect(phaseForFrame({ type: "exit" })).toStrictEqual({ kind: "exited" });
    expect(phaseForFrame({ type: "error", message: "no tmux" })).toStrictEqual({
      kind: "unsupported",
      message: "no tmux",
    });
    expect(phaseForFrame({ type: "data", data: "output" })).toBeUndefined();
  });
});

describe(phaseAfterSocketClose, () => {
  it("marks live and connecting terminals disconnected, keeps terminal phases", () => {
    expect(phaseAfterSocketClose({ kind: "connecting" })).toStrictEqual({ kind: "disconnected" });
    expect(phaseAfterSocketClose({ kind: "live", writer: true })).toStrictEqual({
      kind: "disconnected",
    });
    expect(phaseAfterSocketClose({ kind: "exited" })).toStrictEqual({ kind: "exited" });
    expect(phaseAfterSocketClose({ kind: "unsupported", message: "no tmux" })).toStrictEqual({
      kind: "unsupported",
      message: "no tmux",
    });
  });
});

describe(terminalSocketUrl, () => {
  it("targets the port next to the deck server and escapes the task", () => {
    expect(
      terminalSocketUrl({ protocol: "http:", hostname: "localhost", port: "4400" }, "team-1"),
    ).toBe("ws://localhost:4401/terminal?task=team-1");
  });

  it("uses wss and the default port when the page has none", () => {
    expect(terminalSocketUrl({ protocol: "https:", hostname: "deck.host", port: "" }, "a-b")).toBe(
      "wss://deck.host:444/terminal?task=a-b",
    );
    expect(terminalSocketUrl({ protocol: "http:", hostname: "deck.host", port: "" }, "a-b")).toBe(
      "ws://deck.host:81/terminal?task=a-b",
    );
  });
});

describe(inputFrame, () => {
  it("encodes input and resize frames the server understands", () => {
    expect(inputFrame("ls\r")).toBe(String.raw`{"type":"input","data":"ls\r"}`);
    expect(resizeFrame(120, 40)).toBe('{"type":"resize","cols":120,"rows":40}');
  });
});

describe(phaseBadge, () => {
  it("labels each phase, splitting live by keyboard ownership", () => {
    expect(phaseBadge({ kind: "live", writer: true }).label).toBe("live");
    expect(phaseBadge({ kind: "live", writer: false }).label).toBe("read-only");
    expect(phaseBadge({ kind: "connecting" }).label).toBe("connecting…");
    expect(phaseBadge({ kind: "exited" }).label).toBe("exited");
    expect(phaseBadge({ kind: "disconnected" }).label).toBe("disconnected");
    expect(phaseBadge({ kind: "unsupported", message: "x" }).label).toBe("snapshot");
  });
});
