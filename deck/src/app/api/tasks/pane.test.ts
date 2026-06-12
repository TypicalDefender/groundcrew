import { loadConfig, workspaces } from "@clipboard-health/groundcrew";

import { GET as pane } from "./[task]/pane/route";

vi.mock("@clipboard-health/groundcrew", () => ({
  isPlainTaskId: (task: string) => /^[\da-z]+(?:-[\da-z]+)*$/.test(task),
  loadConfig: vi.fn<() => Promise<unknown>>(),
  workspaces: { capturePane: vi.fn<() => Promise<unknown>>() },
}));

const loadConfigMock = vi.mocked(loadConfig);
const capturePaneMock = vi.mocked(workspaces.capturePane);

interface RouteContext {
  params: Promise<{ task: string }>;
}

function contextFor(task: string): RouteContext {
  return { params: Promise.resolve({ task }) };
}

const request = new Request("http://deck.local/api");

const partialConfig = { deck: { port: 4400, pollIntervalMilliseconds: 5000 } };
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the route only passes config through
const CONFIG = partialConfig as unknown as Awaited<ReturnType<typeof loadConfig>>;

describe("pane route", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns the captured pane text", async () => {
    loadConfigMock.mockResolvedValue(CONFIG);
    capturePaneMock.mockResolvedValue("$ npm test\nall green");

    const response = await pane(request, contextFor("team-1"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({
      ok: true,
      content: "$ npm test\nall green",
    });
    expect(capturePaneMock).toHaveBeenCalledWith(CONFIG, "team-1");
  });

  it("maps a missing pane capture to 404", async () => {
    loadConfigMock.mockResolvedValue(CONFIG);
    // oxlint-disable-next-line unicorn/no-useless-undefined -- the backend reports "cannot capture" as undefined
    capturePaneMock.mockResolvedValue(undefined);

    const response = await pane(request, contextFor("team-1"));

    expect(response.status).toBe(404);
  });

  it("rejects invalid task ids without loading config", async () => {
    const response = await pane(request, contextFor("Not A Task"));

    expect(response.status).toBe(400);
    expect(loadConfigMock).not.toHaveBeenCalled();
  });
});
