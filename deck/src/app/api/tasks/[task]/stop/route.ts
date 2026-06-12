import { interruptWorkspace, loadConfig } from "@clipboard-health/groundcrew";

import { createTaskActionRoute, ok } from "@/lib/controlRoute";

export const dynamic = "force-dynamic";

export const POST = createTaskActionRoute(async (task) => {
  const config = await loadConfig();
  await interruptWorkspace(config, { task, reason: "stopped from the deck" });
  return ok();
});
