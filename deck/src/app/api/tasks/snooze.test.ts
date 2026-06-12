import { loadConfig, parseSnoozeUntil, recordTaskSnooze } from "@clipboard-health/groundcrew";

import { POST as snooze } from "./[task]/snooze/route";

vi.mock("@clipboard-health/groundcrew", () => ({
  isPlainTaskId: (task: string) => /^[\da-z]+(?:-[\da-z]+)*$/.test(task),
  loadConfig: vi.fn<() => Promise<unknown>>(),
  recordTaskSnooze: vi.fn<() => unknown>(),
  parseSnoozeUntil: vi.fn<(raw: string, now: Date) => Date>(),
}));

const loadConfigMock = vi.mocked(loadConfig);
const recordTaskSnoozeMock = vi.mocked(recordTaskSnooze);
const parseSnoozeUntilMock = vi.mocked(parseSnoozeUntil);

const UNTIL = new Date("2026-06-13T10:00:00.000Z");

function fakeUntil(raw: string): Date {
  if (raw === "2h") {
    return UNTIL;
  }
  throw new Error(`crew snooze --until: expected a duration like 2h or a timestamp; got: ${raw}`);
}

interface RouteContext {
  params: Promise<{ task: string }>;
}

function contextFor(task: string): RouteContext {
  return { params: Promise.resolve({ task }) };
}

function request(body: unknown): Request {
  return new Request("http://deck.local/api", { method: "POST", body: JSON.stringify(body) });
}

const partialConfig = { deck: { port: 4400, pollIntervalMilliseconds: 5000 } };
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the route only passes config through
const CONFIG = partialConfig as unknown as Awaited<ReturnType<typeof loadConfig>>;

const partialState = { task: "team-1", snoozedUntil: UNTIL.toISOString() };
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the route only reads snoozedUntil
const SNOOZED_STATE = partialState as unknown as ReturnType<typeof recordTaskSnooze>;
const partialCleared = { task: "team-1" };
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the route only checks for undefined
const CLEARED_STATE = partialCleared as unknown as ReturnType<typeof recordTaskSnooze>;

describe("snooze route", () => {
  beforeEach(() => {
    loadConfigMock.mockResolvedValue(CONFIG);
    parseSnoozeUntilMock.mockImplementation(fakeUntil);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("records the parsed snooze on the task", async () => {
    recordTaskSnoozeMock.mockReturnValue(SNOOZED_STATE);

    const response = await snooze(request({ until: "2h" }), contextFor("team-1"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({
      ok: true,
      snoozedUntil: "2026-06-13T10:00:00.000Z",
    });
    expect(recordTaskSnoozeMock).toHaveBeenCalledWith({
      config: CONFIG,
      task: "team-1",
      until: UNTIL,
    });
  });

  it("clears the snooze with {clear: true}", async () => {
    recordTaskSnoozeMock.mockReturnValue(CLEARED_STATE);

    const response = await snooze(request({ clear: true }), contextFor("team-1"));

    expect(response.status).toBe(200);
    expect(recordTaskSnoozeMock).toHaveBeenCalledWith({ config: CONFIG, task: "team-1" });
  });

  it("maps an unparseable until to 400 with the parser's message", async () => {
    const response = await snooze(request({ until: "whenever" }), contextFor("team-1"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toStrictEqual({
      ok: false,
      error: "crew snooze --until: expected a duration like 2h or a timestamp; got: whenever",
    });
    expect(recordTaskSnoozeMock).not.toHaveBeenCalled();
  });

  it("maps a missing run state to 404", async () => {
    // oxlint-disable-next-line unicorn/no-useless-undefined -- "task never dispatched" is reported as undefined
    recordTaskSnoozeMock.mockReturnValue(undefined);

    const held = await snooze(request({ until: "2h" }), contextFor("team-1"));
    const cleared = await snooze(request({ clear: true }), contextFor("team-1"));

    expect(held.status).toBe(404);
    expect(cleared.status).toBe(404);
  });

  it("rejects bodies without exactly one of until and clear", async () => {
    const neither = await snooze(request({}), contextFor("team-1"));
    const both = await snooze(request({ until: "2h", clear: true }), contextFor("team-1"));
    const wrongClear = await snooze(request({ clear: false }), contextFor("team-1"));
    const blankUntil = await snooze(request({ until: " " }), contextFor("team-1"));

    expect(neither.status).toBe(400);
    expect(both.status).toBe(400);
    expect(wrongClear.status).toBe(400);
    expect(blankUntil.status).toBe(400);
    expect(recordTaskSnoozeMock).not.toHaveBeenCalled();
  });
});
