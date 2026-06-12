import { createSnapshotStream, SSE_HEADERS } from "@/lib/snapshotStream";

interface Harness {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  tick: () => void;
  cleared: unknown[];
}

function makeHarness(collect: () => Promise<unknown>): Harness {
  let tick: (() => void) | undefined;
  const cleared: unknown[] = [];
  const stream = createSnapshotStream({
    collect,
    intervalMilliseconds: 5000,
    schedule: (callback) => {
      tick = callback;
      return 7;
    },
    clearSchedule: (handle) => {
      cleared.push(handle);
    },
  });
  return {
    reader: stream.getReader(),
    tick: () => {
      tick?.();
    },
    cleared,
  };
}

async function readFrame(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const { value, done } = await reader.read();
  expect(done).toBe(false);
  return new TextDecoder().decode(value);
}

function countingCollector(): () => Promise<unknown> {
  let counter = 0;
  return async () => ({ n: (counter += 1) });
}

function failOnceCollector(): () => Promise<unknown> {
  let shouldFail = true;
  return async () => {
    if (shouldFail) {
      shouldFail = false;
      throw new Error("board offline");
    }
    return { ok: true };
  };
}

describe(createSnapshotStream, () => {
  it("pushes one snapshot immediately and one per interval tick", async () => {
    const { reader, tick } = makeHarness(countingCollector());

    await expect(readFrame(reader)).resolves.toBe('data: {"n":1}\n\n');

    tick();

    await expect(readFrame(reader)).resolves.toBe('data: {"n":2}\n\n');
  });

  it("emits a feed-error event instead of killing the stream when collect fails", async () => {
    const { reader, tick } = makeHarness(failOnceCollector());

    await expect(readFrame(reader)).resolves.toBe(
      'event: feed-error\ndata: {"message":"board offline"}\n\n',
    );

    tick();

    await expect(readFrame(reader)).resolves.toBe('data: {"ok":true}\n\n');
  });

  it("stops the timer when the consumer cancels", async () => {
    const { reader, cleared } = makeHarness(countingCollector());
    await readFrame(reader);

    await reader.cancel();

    expect(cleared).toStrictEqual([7]);
  });

  it("declares the standard SSE headers", () => {
    expect(SSE_HEADERS["Content-Type"]).toBe("text/event-stream");
    expect(SSE_HEADERS["Cache-Control"]).toContain("no-cache");
  });
});
