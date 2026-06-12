import { loadConfig, recordTaskAutopilot } from "@clipboard-health/groundcrew";

import { controlError, createTaskActionRoute, ok } from "@/lib/controlRoute";

export const dynamic = "force-dynamic";

/** `{enabled: boolean}` — flips the per-task autopilot kill switch. */
async function readEnabled(request: Request): Promise<boolean | undefined> {
  try {
    const parsed: unknown = await request.json();
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "enabled" in parsed &&
      typeof parsed.enabled === "boolean"
    ) {
      return parsed.enabled;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export const POST = createTaskActionRoute(async (task, request) => {
  const enabled = await readEnabled(request);
  if (enabled === undefined) {
    return controlError(400, "body must be JSON with a boolean `enabled` field");
  }
  const config = await loadConfig();
  // Absent means "autopilot may act", so enabling clears the field.
  const state = recordTaskAutopilot({
    config,
    task,
    ...(enabled ? { clear: ["autopilotEnabled"] } : { set: { autopilotEnabled: false } }),
  });
  if (state === undefined) {
    return controlError(404, `no run state for task ${task}`);
  }
  return ok({ autopilotEnabled: enabled });
});
