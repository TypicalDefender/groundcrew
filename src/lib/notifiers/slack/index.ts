/**
 * Slack notifier: posts crew events to an incoming-webhook URL as one
 * mrkdwn message (`*title*` line, body, optional link).
 */

import { z } from "zod";

import type { CrewEvent } from "../../crewEvents.ts";
import type { Notifier, NotifierDefinition } from "../../notifierDefinition.ts";

const configSchema = z.object({
  kind: z.literal("slack"),
  /** Slack incoming-webhook URL. */
  webhookUrl: z.url(),
});

/** The exact JSON body sent to the webhook. */
export function slackPayload(event: CrewEvent): { text: string } {
  const lines = [`*${event.title}*`, event.body];
  if (event.url !== undefined) {
    lines.push(event.url);
  }
  return { text: lines.join("\n") };
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

/** Factory with a fetch seam so tests never hit the network. */
export function createSlackNotifier(webhookUrl: string, fetchLike: FetchLike = fetch): Notifier {
  return {
    kind: "slack",
    notify: async (event) => {
      const response = await fetchLike(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slackPayload(event)),
      });
      if (!response.ok) {
        throw new Error(`Slack webhook responded ${response.status}`);
      }
    },
  };
}

const definition: NotifierDefinition<typeof configSchema> = {
  kind: "slack",
  configSchema,
  create: (config) => createSlackNotifier(config.webhookUrl),
};

export default definition;
