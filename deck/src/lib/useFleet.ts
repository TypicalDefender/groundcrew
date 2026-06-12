"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";

import { FleetFeed, type FleetFeedState } from "@/lib/fleetFeed";

/** Latest fleet snapshot via the SSE stream, reconnecting on errors. */
export function useFleet(): FleetFeedState {
  const feed = useMemo(() => new FleetFeed(), []);

  useEffect(() => {
    feed.connect();
    return () => {
      feed.close();
    };
  }, [feed]);

  return useSyncExternalStore(
    (listener) => feed.subscribe(listener),
    () => feed.getState(),
    () => feed.getState(),
  );
}
