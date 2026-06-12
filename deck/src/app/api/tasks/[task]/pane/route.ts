import { loadConfig, workspaces } from "@clipboard-health/groundcrew";

import { controlError, createTaskActionRoute, ok } from "@/lib/controlRoute";

export const dynamic = "force-dynamic";

/**
 * Visible pane text for the task's workspace — the terminal fallback for
 * backends that can't stream a live attach.
 */
export const GET = createTaskActionRoute(async (task) => {
  const config = await loadConfig();
  const content = await workspaces.capturePane(config, task);
  if (content === undefined) {
    return controlError(404, `pane capture is not available for task ${task}`);
  }
  return ok({ content });
});
