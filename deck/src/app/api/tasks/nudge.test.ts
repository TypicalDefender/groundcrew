import { loadConfig, workspaces } from "@clipboard-health/groundcrew";

import { POST as nudge } from "./[task]/nudge/route";

vi.mock("@clipboard-health/groundcrew", () => ({
  isPlainTaskId: (task: string) => /^[\da-z]+(?:-[\da-z]+)*$/.test(task),
  loadConfig: vi.fn<() => Promise<unknown>>(),
  workspaces: { sendText: vi.fn<() => Promise<unknown>>() },
}));

const loadConfigMock = vi.mocked(loadConfig);
const sendTextMock = vi.mocked(workspaces.sendText);

interface RouteContext {
  params: Promise<{ task: string }>;
}

function contextFor(task: string): RouteContext {
  return { params: Promise.resolve({ task }) };
}

function request(body?: unknown): Request {
  return new Request("http://deck.local/api", {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const partialConfig = { deck: { port: 4400, pollIntervalMilliseconds: 5000 } };
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the route only passes config through
const CONFIG = partialConfig as unknown as Awaited<ReturnType<typeof loadConfig>>;

describe("nudge route", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("delivers the text to the task's workspace", async () => {
    loadConfigMock.mockResolvedValue(CONFIG);
    sendTextMock.mockResolvedValue({ kind: "sent" });

    const response = await nudge(request({ text: "please run the tests" }), contextFor("team-1"));

    expect(response.status).toBe(200);
    expect(sendTextMock).toHaveBeenCalledWith(CONFIG, "team-1", "please run the tests");
  });

  it("rejects empty and missing text without touching the workspace", async () => {
    loadConfigMock.mockResolvedValue(CONFIG);

    const blank = await nudge(request({ text: "   " }), contextFor("team-1"));
    const absent = await nudge(request(), contextFor("team-1"));

    expect(blank.status).toBe(400);
    expect(absent.status).toBe(400);
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it("maps a missing workspace to 404 and a backend failure to 409", async () => {
    loadConfigMock.mockResolvedValue(CONFIG);
    sendTextMock.mockResolvedValueOnce({ kind: "missing" });
    const missing = await nudge(request({ text: "hi" }), contextFor("team-1"));
    expect(missing.status).toBe(404);

    sendTextMock.mockResolvedValueOnce({ kind: "unavailable" });
    const unavailable = await nudge(request({ text: "hi" }), contextFor("team-1"));
    expect(unavailable.status).toBe(409);
  });
});
