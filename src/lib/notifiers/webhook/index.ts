/**
 * Generic webhook notifier: POSTs the crew event as documented JSON to
 * any URL, with optional extra headers.
 *
 * Payload shape (one event per request):
 *
 * ```json
 * {
 *   "kind": "task-stuck",
 *   "priority": "urgent",
 *   "title": "team-1 looks stuck",
 *   "body": "Pulse unchanged for 12m.",
 *   "at": "2026-06-13T08:00:00.000Z",
 *   "task": "team-1",
 *   "url": "https://github.com/acme/repo-a/pull/7"
 * }
 * ```
 *
 * `task` and `url` are present only when the event carries them.
 */

import { z } from "zod";

import type { CrewEvent } from "../../crewEvents.ts";
import type { Notifier, NotifierDefinition } from "../../notifierDefinition.ts";
import type { FetchLike } from "../slack/index.ts";

const configSchema = z.object({
  kind: z.literal("webhook"),
  url: z.url(),
  /** Extra request headers, e.g. an Authorization token. */
  headers: z.record(z.string(), z.string()).optional(),
});

/** The exact JSON body: the event itself, no envelope. */
export function webhookPayload(event: CrewEvent): CrewEvent {
  return event;
}

/** Factory with a fetch seam so tests never hit the network. */
export function createWebhookNotifier(
  url: string,
  headers: Record<string, string> = {},
  fetchLike: FetchLike = fetch,
): Notifier {
  return {
    kind: "webhook",
    notify: async (event) => {
      const response = await fetchLike(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(webhookPayload(event)),
      });
      if (!response.ok) {
        throw new Error(`Webhook responded ${response.status}`);
      }
    },
  };
}

const definition: NotifierDefinition<typeof configSchema> = {
  kind: "webhook",
  configSchema,
  create: (config) => createWebhookNotifier(config.url, config.headers),
};

export default definition;
