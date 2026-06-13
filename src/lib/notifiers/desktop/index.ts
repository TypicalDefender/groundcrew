/**
 * Desktop notifier: macOS `osascript` notification banners, Linux
 * `notify-send` (urgent events map to critical urgency). Other platforms
 * are a logged no-op — a missing banner should never break a tick.
 */

import { z } from "zod";

import { runCommandAsync } from "../../commandRunner.ts";
import type { CrewEvent } from "../../crewEvents.ts";
import type { Notifier, NotifierDefinition } from "../../notifierDefinition.ts";
import { log } from "../../util.ts";

const configSchema = z.object({ kind: z.literal("desktop") });

export interface DesktopCommand {
  command: string;
  arguments: string[];
}

/** Escape for embedding inside a double-quoted AppleScript string. */
function appleScriptQuote(text: string): string {
  return text.replaceAll("\\", String.raw`\\`).replaceAll('"', String.raw`\"`);
}

/** The platform-specific notification command, or undefined off desktop. */
export function buildDesktopCommand(
  event: CrewEvent,
  platform: NodeJS.Platform,
): DesktopCommand | undefined {
  if (platform === "darwin") {
    const script = `display notification "${appleScriptQuote(event.body)}" with title "${appleScriptQuote(event.title)}"`;
    return { command: "osascript", arguments: ["-e", script] };
  }
  if (platform === "linux") {
    return {
      command: "notify-send",
      arguments: [
        "--urgency",
        event.priority === "urgent" ? "critical" : "normal",
        event.title,
        event.body,
      ],
    };
  }
  return undefined;
}

export type DesktopCommandRunner = (
  command: string,
  arguments_: readonly string[],
) => Promise<unknown>;

/* v8 ignore next 3 @preserve -- thin adapter over runCommandAsync; tests inject fake runners */
async function runDesktopCommand(command: string, arguments_: readonly string[]): Promise<unknown> {
  return await runCommandAsync(command, arguments_);
}

/** Factory with seams so tests never spawn anything. */
export function createDesktopNotifier(
  run: DesktopCommandRunner = runDesktopCommand,
  platform: NodeJS.Platform = process.platform,
): Notifier {
  return {
    kind: "desktop",
    notify: async (event) => {
      const desktopCommand = buildDesktopCommand(event, platform);
      if (desktopCommand === undefined) {
        log(`Desktop notifier: no notification command on ${platform}; skipping ${event.kind}`);
        return;
      }
      await run(desktopCommand.command, desktopCommand.arguments);
    },
  };
}

const definition: NotifierDefinition<typeof configSchema> = {
  kind: "desktop",
  configSchema,
  create: () => createDesktopNotifier(),
};

export default definition;
