import {
  clearPause,
  loadConfig,
  parseDurationMilliseconds,
  recordPause,
} from "@clipboard-health/groundcrew";

import { POST as pause } from "./pause/route";
import { POST as wake } from "./wake/route";

vi.mock("@clipboard-health/groundcrew", () => ({
  loadConfig: vi.fn<() => Promise<unknown>>(),
  recordPause: vi.fn<() => unknown>(),
  clearPause: vi.fn<() => boolean>(),
  parseDurationMilliseconds: vi.fn<(raw: string) => number>(),
  emitCrewEvent: vi.fn<() => Promise<unknown>>(async () => ({})),
}));

const loadConfigMock = vi.mocked(loadConfig);
const recordPauseMock = vi.mocked(recordPause);
const clearPauseMock = vi.mocked(clearPause);
const parseDurationMock = vi.mocked(parseDurationMilliseconds);

function fakeDuration(raw: string): number {
  if (raw === "2h") {
    return 7_200_000;
  }
  throw new Error(`crew pause --for: expected a duration like 30m, 2h, or 1d; got: ${raw}`);
}

function firstPauseInput(): Parameters<typeof recordPause>[0] {
  const [call] = recordPauseMock.mock.calls;
  if (call === undefined) {
    throw new Error("expected recordPause to be called");
  }
  const [input] = call;
  return input;
}

function expiryDeltaMilliseconds(input: Parameters<typeof recordPause>[0]): number {
  if (input.until === undefined || input.now === undefined) {
    throw new Error("expected a bounded pause with a now timestamp");
  }
  return input.until.getTime() - input.now.getTime();
}

function request(body?: unknown): Request {
  return new Request("http://deck.local/api", {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const partialConfig = { deck: { port: 4400, pollIntervalMilliseconds: 5000 } };
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the routes only pass config through
const CONFIG = partialConfig as unknown as Awaited<ReturnType<typeof loadConfig>>;

const RECORDED = { pausedAt: "2026-06-13T08:00:00.000Z" };

describe("pause route", () => {
  beforeEach(() => {
    loadConfigMock.mockResolvedValue(CONFIG);
    recordPauseMock.mockReturnValue(RECORDED);
    parseDurationMock.mockImplementation(fakeDuration);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("records an indefinite pause for an empty body", async () => {
    const response = await pause(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ ok: true, pause: RECORDED });
    const input = firstPauseInput();
    expect(input.config).toBe(CONFIG);
    expect(input.until).toBeUndefined();
    expect(input.now).toBeInstanceOf(Date);
  });

  it("bounds the pause by the requested duration and keeps the reason", async () => {
    const response = await pause(request({ for: "2h", reason: "lunch" }));

    expect(response.status).toBe(200);
    const input = firstPauseInput();
    expect(input.reason).toBe("lunch");
    expect(expiryDeltaMilliseconds(input)).toBe(7_200_000);
  });

  it("rejects a malformed duration with the parser's message", async () => {
    const response = await pause(request({ for: "soon" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toStrictEqual({
      ok: false,
      error: "crew pause --for: expected a duration like 30m, 2h, or 1d; got: soon",
    });
    expect(recordPauseMock).not.toHaveBeenCalled();
  });

  it("rejects non-string fields and blank reasons without touching state", async () => {
    const wrongType = await pause(request({ for: 5 }));
    const blankReason = await pause(request({ reason: "   " }));
    const nonObject = await pause(request("2h"));

    expect(wrongType.status).toBe(400);
    expect(blankReason.status).toBe(400);
    expect(nonObject.status).toBe(400);
    expect(recordPauseMock).not.toHaveBeenCalled();
  });
});

describe("wake route", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("clears the pause and reports whether one existed", async () => {
    loadConfigMock.mockResolvedValue(CONFIG);
    clearPauseMock.mockReturnValueOnce(true).mockReturnValueOnce(false);

    const woke = await wake();
    const alreadyAwake = await wake();

    await expect(woke.json()).resolves.toStrictEqual({ ok: true, woke: true });
    await expect(alreadyAwake.json()).resolves.toStrictEqual({ ok: true, woke: false });
  });

  it("maps a config failure to 409", async () => {
    loadConfigMock.mockRejectedValue(new Error("config exploded"));

    const response = await wake();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toStrictEqual({ ok: false, error: "config exploded" });
  });
});
