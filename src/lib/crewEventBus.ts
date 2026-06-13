/**
 * The single choke point for crew notifications. A process that wants
 * events delivered (the watch orchestrator, the deck server, the
 * pause/wake commands) calls `initializeCrewEvents(config)` once; every
 * later `emitCrewEvent(...)` builds the event and fans it out through the
 * configured notifiers and routing table. Uninitialized processes (tests,
 * one-off CLI reads) emit into the void by design — observation paths can
 * call emit unconditionally without coupling to notification setup.
 */

import type { ResolvedConfig } from "./config.ts";
import { type CrewEvent, makeCrewEvent, type MakeCrewEventInput } from "./crewEvents.ts";
import type { Notifier } from "./notifierDefinition.ts";
import type { DispatchCrewEventInput, NotificationRouting } from "./notifiers/resolve.ts";
import { errorMessage, log } from "./util.ts";

interface CrewEventSink {
  dispatch: (input: DispatchCrewEventInput) => Promise<void>;
  notifiers: readonly Notifier[];
  routing: NotificationRouting | undefined;
}

let activeSink: CrewEventSink | undefined;

/**
 * Build the configured notifiers once and start delivering events. A
 * config without notifiers leaves emission as a no-op. Never throws — a
 * bad notifier config is logged and notifications stay off, because the
 * crew must keep working without its banners.
 */
export async function initializeCrewEvents(config: ResolvedConfig): Promise<void> {
  const blocks = config.notifiers ?? [];
  if (blocks.length === 0) {
    activeSink = undefined;
    return;
  }
  try {
    // Loaded lazily so merely importing this module (every run-state write
    // path does) never triggers the notifier registry's directory scan.
    const { buildNotifiers, dispatchCrewEvent } = await import("./notifiers/resolve.ts");
    activeSink = {
      dispatch: dispatchCrewEvent,
      notifiers: await buildNotifiers(blocks, { globalConfig: config }),
      routing: config.notifications,
    };
  } catch (error) {
    activeSink = undefined;
    log(`Notifications disabled (notifier config invalid): ${errorMessage(error)}`);
  }
}

/** Tests only: forget the active sink. */
export function resetCrewEventsForTesting(): void {
  activeSink = undefined;
}

/**
 * Emit one crew event through the active sink. Resolves once delivery
 * attempts finish; synchronous call sites may `void` it — failures are
 * logged per notifier, never thrown.
 */
export async function emitCrewEvent(input: MakeCrewEventInput): Promise<CrewEvent> {
  const event = makeCrewEvent(input);
  if (activeSink !== undefined) {
    await activeSink.dispatch({
      event,
      notifiers: activeSink.notifiers,
      ...(activeSink.routing === undefined ? {} : { routing: activeSink.routing }),
    });
  }
  return event;
}
