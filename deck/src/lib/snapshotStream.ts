/**
 * Server-sent-events stream of fleet snapshots. One snapshot is pushed
 * immediately on connect, then one per poll interval, each as a single
 * `data:` event. Collection failures become `event: feed-error` events
 * rather than killing the stream — the deck shows a banner and keeps
 * listening.
 */

export interface SnapshotStreamInput {
  /** Produces the payload for each tick (the fleet snapshot, serialized here). */
  collect: () => Promise<unknown>;
  intervalMilliseconds: number;
  /** Test seams; default to the real timer functions. */
  schedule?: (callback: () => void, ms: number) => unknown;
  clearSchedule?: (handle: unknown) => void;
}

export function createSnapshotStream(input: SnapshotStreamInput): ReadableStream<Uint8Array> {
  const { collect, intervalMilliseconds } = input;
  const schedule = input.schedule ?? setInterval;
  const clearSchedule =
    input.clearSchedule ??
    ((handle): void => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the default schedule seam always produces a real timer handle
      clearInterval(handle as ReturnType<typeof setInterval>);
    });
  const encoder = new TextEncoder();
  let timer: unknown;
  let closed = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      async function push(): Promise<void> {
        let payload: string;
        let eventName: string | undefined;
        try {
          payload = JSON.stringify(await collect());
        } catch (error) {
          eventName = "feed-error";
          payload = JSON.stringify({
            message: error instanceof Error ? error.message : String(error),
          });
        }
        if (closed) {
          return;
        }
        const lines = eventName === undefined ? "" : `event: ${eventName}\n`;
        controller.enqueue(encoder.encode(`${lines}data: ${payload}\n\n`));
      }

      await push();
      timer = schedule(() => {
        void push();
      }, intervalMilliseconds);
    },
    cancel() {
      closed = true;
      if (timer !== undefined) {
        clearSchedule(timer);
      }
    },
  });
}

/** Response headers every SSE endpoint needs. */
export const SSE_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};
