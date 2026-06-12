import { setupWorkspaceCli } from "@clipboard-health/groundcrew";

import { createTaskActionRoute, ok } from "@/lib/controlRoute";

export const dynamic = "force-dynamic";

export const POST = createTaskActionRoute(async (task) => {
  await setupWorkspaceCli(task);
  return ok();
});
