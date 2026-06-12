import { loadConfig, resumeWorkspace } from "@clipboard-health/groundcrew";

import { createTaskActionRoute, ok } from "@/lib/controlRoute";

export const dynamic = "force-dynamic";

export const POST = createTaskActionRoute(async (task) => {
  const config = await loadConfig();
  await resumeWorkspace(config, { task });
  return ok();
});
