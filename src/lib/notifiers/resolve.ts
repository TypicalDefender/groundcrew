/**
 * Notifier resolution and routing: turn the config's `notifiers` blocks
 * into live Notifier instances via the registry, decide which of them an
 * event reaches (the `notifications` routing table — absent means
 * everyone), and fan an event out without letting one broken notifier
 * starve the rest.
 */

import { z } from "zod";

import type { ResolvedConfig } from "../config.ts";
import type { CrewEvent, CrewEventPriority } from "../crewEvents.ts";
import type { Notifier, NotifierContext, NotifierDefinition } from "../notifierDefinition.ts";
import { errorMessage, log } from "../util.ts";
import { notifierRegistry } from "./registry.ts";

const kindShape = z.object({ kind: z.string() });

export interface NotificationRouting {
  urgent?: readonly string[];
  action?: readonly string[];
  info?: readonly string[];
}

/**
 * Production entry point: awaits the directory-scanned registry, then
 * dispatches. Mirrors `buildSources`.
 */
export async function buildNotifiers(
  rawConfigs: readonly unknown[],
  context: NotifierContext,
): Promise<Notifier[]> {
  const registry = await notifierRegistry;
  return buildNotifiersWith(registry, rawConfigs, context);
}

/** Pure dispatcher: caller supplies the registry directly. */
export function buildNotifiersWith(
  registry: Record<string, NotifierDefinition>,
  rawConfigs: readonly unknown[],
  context: NotifierContext,
): Notifier[] {
  return rawConfigs.map((raw) => {
    const { kind } = kindShape.parse(raw);
    const definition = registry[kind];
    if (!definition) {
      throw new Error(
        `Unknown notifier kind "${kind}". Registered: ${Object.keys(registry).join(", ") || "(none)"}`,
      );
    }
    const config: unknown = definition.configSchema.parse(raw);
    return definition.create(config, context);
  });
}

/**
 * The notifiers an event of this priority reaches. No routing table means
 * every configured notifier; an empty list for a priority means silence.
 */
export function routeEvent(
  priority: CrewEventPriority,
  routing: NotificationRouting | undefined,
  notifiers: readonly Notifier[],
): Notifier[] {
  if (routing === undefined) {
    return [...notifiers];
  }
  const kinds = new Set(routing[priority]);
  return notifiers.filter((notifier) => kinds.has(notifier.kind));
}

export interface DispatchCrewEventInput {
  event: CrewEvent;
  notifiers: readonly Notifier[];
  routing?: NotificationRouting;
}

/** Fan-out with per-notifier error isolation. */
export async function dispatchCrewEvent(input: DispatchCrewEventInput): Promise<void> {
  const recipients = routeEvent(input.event.priority, input.routing, input.notifiers);
  for (const notifier of recipients) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- notifiers fire sequentially so output stays readable
      await notifier.notify(input.event);
    } catch (error) {
      log(`Notifier ${notifier.kind} failed for ${input.event.kind}: ${errorMessage(error)}`);
    }
  }
}

/** Routing slice carried on the resolved config. */
export function notificationRouting(
  config: Pick<ResolvedConfig, "notifications">,
): NotificationRouting | undefined {
  return config.notifications;
}
