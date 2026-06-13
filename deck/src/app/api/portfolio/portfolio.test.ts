import { collectPortfolioSnapshot } from "@clipboard-health/groundcrew";

import { GET as portfolio } from "./route";

vi.mock("@clipboard-health/groundcrew", () => ({
  collectPortfolioSnapshot: vi.fn<() => Promise<unknown>>(),
}));

const collectMock = vi.mocked(collectPortfolioSnapshot);

describe("portfolio route", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns the aggregated snapshot as JSON", async () => {
    const snapshot = { collectedAt: "2026-06-13T08:00:00.000Z", entries: [] };
    collectMock.mockResolvedValue(snapshot);

    const response = await portfolio();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual(snapshot);
  });
});
