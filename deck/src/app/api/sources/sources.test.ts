import { buildSources, loadConfig } from "@clipboard-health/groundcrew";

import { POST as createTask } from "../tasks/route";
import { GET as listSources } from "./route";

vi.mock("@clipboard-health/groundcrew", () => ({
  loadConfig: vi.fn<() => Promise<unknown>>(),
  buildSources: vi.fn<() => Promise<unknown[]>>(),
  sourcesFromConfig: vi.fn<() => unknown[]>(() => []),
  isPlainTaskId: () => true,
}));

const loadConfigMock = vi.mocked(loadConfig);
const buildSourcesMock = vi.mocked(buildSources);

type Source = Awaited<ReturnType<typeof buildSources>>[number];

function source(name: string, create?: () => Promise<unknown>): Source {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the routes touch only name and createTask
  return { name, ...(create === undefined ? {} : { createTask: create }) } as unknown as Source;
}

function draftRequest(body: unknown): Request {
  return new Request("http://deck.local/api/tasks", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const partial = { deck: { port: 4400, pollIntervalMilliseconds: 5000 } };
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the routes only pass config through
const CONFIG = partial as unknown as Awaited<ReturnType<typeof loadConfig>>;

describe("GET /api/sources", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reports which sources can create tasks", async () => {
    loadConfigMock.mockResolvedValue(CONFIG);
    buildSourcesMock.mockResolvedValue([
      source("todo", async () => ({ id: "todo:x" })),
      source("linear"),
    ]);

    const response = await listSources();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({
      sources: [
        { name: "todo", supportsCreate: true },
        { name: "linear", supportsCreate: false },
      ],
    });
  });

  it("answers 500 with the reason when sources cannot be built", async () => {
    loadConfigMock.mockRejectedValue(new Error("no crew config found"));

    const response = await listSources();

    expect(response.status).toBe(500);
  });
});

describe("POST /api/tasks (draft)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates a task through the named source", async () => {
    const create = vi.fn<() => Promise<unknown>>().mockResolvedValue({ id: "todo:gc-1" });
    loadConfigMock.mockResolvedValue(CONFIG);
    buildSourcesMock.mockResolvedValue([source("todo", create)]);

    const response = await createTask(
      draftRequest({ source: "todo", title: "Ship it", agent: "claude" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ ok: true, id: "todo:gc-1" });
    expect(create).toHaveBeenCalledWith({
      title: "Ship it",
      agent: "claude",
      projects: [],
      contexts: [],
      dependencies: [],
      edit: false,
    });
  });

  it("rejects bodies missing source, title, or agent", async () => {
    const response = await createTask(draftRequest({ title: "x" }));

    expect(response.status).toBe(400);
    expect(buildSourcesMock).not.toHaveBeenCalled();
  });

  it("maps unknown sources to 404 and read-only sources to 409", async () => {
    loadConfigMock.mockResolvedValue(CONFIG);
    buildSourcesMock.mockResolvedValue([source("linear")]);

    const unknown = await createTask(draftRequest({ source: "ghost", title: "x", agent: "any" }));
    expect(unknown.status).toBe(404);

    const readOnly = await createTask(draftRequest({ source: "linear", title: "x", agent: "any" }));
    expect(readOnly.status).toBe(409);
  });
});
