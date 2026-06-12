/**
 * Client-side fleet feed: consumes the `/api/fleet/stream` SSE endpoint and
 * exposes the latest snapshot to subscribers, reconnecting with a fixed
 * delay whenever the source errors. Framework-free so the logic is testable
 * without React; `useFleet` is the thin hook wrapper.
 */

import type { FleetSnapshot } from "@clipboard-health/groundcrew";

/** The slice of EventSource the feed uses; tests substitute a fake. */
export interface FleetEventSource {
  addEventListener: (
    type: "message" | "error",
    listener: (event: MessageEvent<string>) => void,
  ) => void;
  close: () => void;
}

export interface FleetFeedState {
  snapshot: FleetSnapshot | undefined;
  /** True between a source error and the next successful message. */
  degraded: boolean;
}

export interface FleetFeedOptions {
  url?: string;
  retryDelayMilliseconds?: number;
  /** Test seams. */
  createSource?: (url: string) => FleetEventSource;
  schedule?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearSchedule?: (handle: ReturnType<typeof setTimeout>) => void;
}

const DEFAULT_STREAM_URL = "/api/fleet/stream";
const DEFAULT_RETRY_DELAY_MILLISECONDS = 3000;

export class FleetFeed {
  private state: FleetFeedState = { snapshot: undefined, degraded: false };
  private readonly listeners = new Set<() => void>();
  private source: FleetEventSource | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  private readonly url: string;
  private readonly retryDelayMilliseconds: number;
  private readonly createSource: (url: string) => FleetEventSource;
  private readonly schedule: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearSchedule: (handle: ReturnType<typeof setTimeout>) => void;

  public constructor(options: FleetFeedOptions = {}) {
    this.url = options.url ?? DEFAULT_STREAM_URL;
    this.retryDelayMilliseconds =
      options.retryDelayMilliseconds ?? DEFAULT_RETRY_DELAY_MILLISECONDS;
    this.createSource =
      options.createSource ??
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- EventSource satisfies the narrowed listener contract
      ((url): FleetEventSource => new EventSource(url) as unknown as FleetEventSource);
    this.schedule = options.schedule ?? setTimeout;
    this.clearSchedule = options.clearSchedule ?? clearTimeout;
  }

  public connect(): void {
    if (this.closed || this.source !== undefined) {
      return;
    }
    const source = this.createSource(this.url);
    this.source = source;
    source.addEventListener("message", (event) => {
      this.receive(event.data);
    });
    source.addEventListener("error", () => {
      this.dropAndRetry();
    });
  }

  public close(): void {
    this.closed = true;
    if (this.retryTimer !== undefined) {
      this.clearSchedule(this.retryTimer);
      this.retryTimer = undefined;
    }
    this.source?.close();
    this.source = undefined;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getState(): FleetFeedState {
    return this.state;
  }

  private receive(data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // a malformed frame is dropped; the next tick replaces it
    }
    if (typeof parsed !== "object" || parsed === null || !("tasks" in parsed)) {
      return;
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape-checked above; the server serializes a FleetSnapshot
    this.state = { snapshot: parsed as FleetSnapshot, degraded: false };
    this.emit();
  }

  private dropAndRetry(): void {
    this.source?.close();
    this.source = undefined;
    if (!this.state.degraded) {
      this.state = { ...this.state, degraded: true };
      this.emit();
    }
    if (this.closed || this.retryTimer !== undefined) {
      return;
    }
    this.retryTimer = this.schedule(() => {
      this.retryTimer = undefined;
      this.connect();
    }, this.retryDelayMilliseconds);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
