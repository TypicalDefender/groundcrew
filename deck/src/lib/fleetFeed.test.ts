import { FleetFeed, type FleetEventSource } from "@/lib/fleetFeed";

class FakeSource implements FleetEventSource {
  public closeCount = 0;
  private readonly handlers = new Map<string, (event: MessageEvent<string>) => void>();

  public addEventListener(
    type: "message" | "error",
    listener: (event: MessageEvent<string>) => void,
  ): void {
    this.handlers.set(type, listener);
  }

  public close(): void {
    this.closeCount += 1;
  }

  public emit(data: string): void {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the feed only reads .data
    this.handlers.get("message")?.({ data } as MessageEvent<string>);
  }

  public fail(): void {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the feed ignores the error payload
    this.handlers.get("error")?.(new Event("error") as unknown as MessageEvent<string>);
  }
}

const SNAPSHOT = JSON.stringify({
  timestamp: "2026-06-12T10:00:00.000Z",
  tasks: [],
  straySessions: [],
  board: { kind: "ok" },
  workspaces: { kind: "ok" },
});

interface Harness {
  feed: FleetFeed;
  sources: FakeSource[];
  fireRetry: () => void;
  retryCount: () => number;
}

function makeHarness(): Harness {
  const sources: FakeSource[] = [];
  const retries: (() => void)[] = [];
  const feed = new FleetFeed({
    createSource: () => {
      const source = new FakeSource();
      sources.push(source);
      return source;
    },
    schedule: (callback) => {
      retries.push(callback);
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- opaque handle; the feed never inspects it
      return retries.length as unknown as ReturnType<typeof setTimeout>;
    },
    clearSchedule: () => {
      // retries in these tests are driven manually via fireRetry
    },
  });
  return {
    feed,
    sources,
    fireRetry: () => {
      retries.at(-1)?.();
    },
    retryCount: () => retries.length,
  };
}

describe(FleetFeed, () => {
  it("exposes parsed snapshots to subscribers", () => {
    const { feed, sources } = makeHarness();
    const seen: (number | undefined)[] = [];
    feed.subscribe(() => {
      seen.push(feed.getState().snapshot?.tasks.length);
    });

    feed.connect();
    sources[0]?.emit(SNAPSHOT);

    expect(seen).toStrictEqual([0]);
    expect(feed.getState().degraded).toBe(false);
  });

  it("ignores malformed and non-snapshot frames", () => {
    const { feed, sources } = makeHarness();
    feed.connect();

    sources[0]?.emit("not json");
    sources[0]?.emit('{"message":"hello"}');

    expect(feed.getState().snapshot).toBeUndefined();
  });

  it("marks the feed degraded on error and reconnects after the retry delay", () => {
    const { feed, sources, fireRetry } = makeHarness();
    feed.connect();
    sources[0]?.emit(SNAPSHOT);

    sources[0]?.fail();

    expect(feed.getState().degraded).toBe(true);
    expect(feed.getState().snapshot).toBeDefined();
    expect(sources[0]?.closeCount).toBe(1);

    fireRetry();
    expect(sources).toHaveLength(2);

    sources[1]?.emit(SNAPSHOT);
    expect(feed.getState().degraded).toBe(false);
  });

  it("schedules only one retry at a time", () => {
    const { feed, sources, retryCount } = makeHarness();
    feed.connect();

    sources[0]?.fail();
    sources[0]?.fail();

    expect(retryCount()).toBe(1);
  });

  it("never reconnects after close", () => {
    const { feed, sources, fireRetry } = makeHarness();
    feed.connect();
    sources[0]?.fail();

    feed.close();
    fireRetry();

    expect(sources).toHaveLength(1);
    feed.connect();
    expect(sources).toHaveLength(1);
  });

  it("unsubscribes listeners", () => {
    const { feed, sources } = makeHarness();
    const seen: string[] = [];
    const unsubscribe = feed.subscribe(() => {
      seen.push("called");
    });

    unsubscribe();
    feed.connect();
    sources[0]?.emit(SNAPSHOT);

    expect(seen).toStrictEqual([]);
  });
});
