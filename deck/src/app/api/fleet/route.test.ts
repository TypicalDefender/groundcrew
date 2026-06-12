import { collectFleetSnapshot, loadConfig } from "@clipboard-health/groundcrew";

import { GET as getFleet } from "./route";
import { GET as getStream } from "./stream/route";

vi.mock("@clipboard-health/groundcrew", () => ({
  loadConfig: vi.fn<() => Promise<unknown>>(),
  collectFleetSnapshot: vi.fn<() => Promise<unknown>>(),
}));

const loadConfigMock = vi.mocked(loadConfig);
const collectMock = vi.mocked(collectFleetSnapshot);

const SNAPSHOT = {
  timestamp: "2026-06-12T10:00:00.000Z",
  tasks: [],
  straySessions: [],
  board: { kind: "ok" as const },
  workspaces: { kind: "ok" as const },
};

function fakeConfig(): Awaited<ReturnType<typeof loadConfig>> {
  const partial = { deck: { port: 4400, pollIntervalMilliseconds: 5000 } };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the routes only read config.deck
  return partial as unknown as Awaited<ReturnType<typeof loadConfig>>;
}

async function readFirstFrame(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  expect(reader).toBeDefined();
  const result = await reader?.read();
  await reader?.cancel();
  return new TextDecoder().decode(result?.value);
}

describe("GET /api/fleet", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns the fleet snapshot as JSON", async () => {
    loadConfigMock.mockResolvedValue(fakeConfig());
    collectMock.mockResolvedValue(SNAPSHOT);

    const response = await getFleet();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual(SNAPSHOT);
  });

  it("answers 500 with the failure message when collection fails", async () => {
    loadConfigMock.mockRejectedValue(new Error("no crew config found"));

    const response = await getFleet();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toStrictEqual({ message: "no crew config found" });
  });
});

describe("GET /api/fleet/stream", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("streams snapshots as server-sent events", async () => {
    loadConfigMock.mockResolvedValue(fakeConfig());
    collectMock.mockResolvedValue(SNAPSHOT);

    const response = await getStream();

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    const frame = await readFirstFrame(response);
    expect(frame.startsWith("data: ")).toBe(true);
    expect(JSON.parse(frame.slice("data: ".length))).toStrictEqual(SNAPSHOT);
  });

  it("answers 500 when the config cannot be loaded", async () => {
    loadConfigMock.mockRejectedValue(new Error("boom"));

    const response = await getStream();

    expect(response.status).toBe(500);
  });
});
