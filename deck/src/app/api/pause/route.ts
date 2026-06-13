import {
  emitCrewEvent,
  loadConfig,
  parseDurationMilliseconds,
  recordPause,
} from "@clipboard-health/groundcrew";

import { controlError, ok } from "@/lib/controlRoute";
import { restoreOperatorDirectory } from "@/lib/crewEnvironment";

export const dynamic = "force-dynamic";

interface PauseBody {
  for?: string;
  reason?: string;
}

/** Body is optional; `{for: "2h", reason: "lunch"}` bounds the pause. */
async function readBody(request: Request): Promise<PauseBody | undefined> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  const body: PauseBody = {};
  if ("for" in parsed) {
    if (typeof parsed.for !== "string") {
      return undefined;
    }
    body.for = parsed.for;
  }
  if ("reason" in parsed) {
    if (typeof parsed.reason !== "string" || parsed.reason.trim().length === 0) {
      return undefined;
    }
    body.reason = parsed.reason;
  }
  return body;
}

export async function POST(request: Request): Promise<Response> {
  const body = await readBody(request);
  if (body === undefined) {
    return controlError(400, "body must be JSON with optional string fields `for` and `reason`");
  }
  restoreOperatorDirectory();
  try {
    const now = new Date();
    const until =
      body.for === undefined
        ? undefined
        : new Date(now.getTime() + parseDurationMilliseconds(body.for));
    const config = await loadConfig();
    const state = recordPause({
      config,
      now,
      ...(until === undefined ? {} : { until }),
      ...(body.reason === undefined ? {} : { reason: body.reason }),
    });
    await emitCrewEvent({
      kind: "crew-paused",
      title: "Crew paused",
      body: state.until === undefined ? "Paused until woken." : `Paused until ${state.until}.`,
      now,
    });
    return ok({ pause: state });
  } catch (error) {
    return controlError(400, error instanceof Error ? error.message : String(error));
  }
}
