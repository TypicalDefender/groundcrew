import { loadConfig, recordTaskAutopilot } from "@clipboard-health/groundcrew";

import { POST as autopilot } from "./[task]/autopilot/route";

vi.mock("@clipboard-health/groundcrew", () => ({
  isPlainTaskId: (task: string) => /^[\da-z]+(?:-[\da-z]+)*$/.test(task),
  loadConfig: vi.fn<() => Promise<unknown>>(),
  recordTaskAutopilot: vi.fn<() => unknown>(),
}));

const loadConfigMock = vi.mocked(loadConfig);
const recordMock = vi.mocked(recordTaskAutopilot);

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

const partialState = { task: "team-1" };
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the route only checks for undefined
const STATE = partialState as unknown as ReturnType<typeof recordTaskAutopilot>;

describe("autopilot toggle route", () => {
  beforeEach(() => {
    loadConfigMock.mockResolvedValue(CONFIG);
    recordMock.mockReturnValue(STATE);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("turning autopilot off sets the kill switch on the run state", async () => {
    const response = await autopilot(request({ enabled: false }), contextFor("team-1"));

    expect(response.status).toBe(200);
    expect(recordMock).toHaveBeenCalledWith({
      config: CONFIG,
      task: "team-1",
      set: { autopilotEnabled: false },
    });
  });

  it("turning autopilot on clears the kill switch", async () => {
    const response = await autopilot(request({ enabled: true }), contextFor("team-1"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ ok: true, autopilotEnabled: true });
    expect(recordMock).toHaveBeenCalledWith({
      config: CONFIG,
      task: "team-1",
      clear: ["autopilotEnabled"],
    });
  });

  it("rejects non-boolean bodies and maps missing run states to 404", async () => {
    const wrong = await autopilot(request({ enabled: "yes" }), contextFor("team-1"));
    expect(wrong.status).toBe(400);
    expect(recordMock).not.toHaveBeenCalled();

    // oxlint-disable-next-line unicorn/no-useless-undefined -- "task never dispatched" is reported as undefined
    recordMock.mockReturnValue(undefined);
    const ghost = await autopilot(request({ enabled: false }), contextFor("team-1"));
    expect(ghost.status).toBe(404);
  });
});
