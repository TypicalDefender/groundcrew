import { cleanupWorkspace, loadConfig } from "@clipboard-health/groundcrew";

import { createTaskActionRoute, ok } from "@/lib/controlRoute";

export const dynamic = "force-dynamic";

export const POST = createTaskActionRoute(async (task, request) => {
  const force = await readForceFlag(request);
  const config = await loadConfig();
  await cleanupWorkspace(config, { task, force });
  return ok();
});

async function readForceFlag(request: Request): Promise<boolean> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && "force" in body && body.force === true;
  } catch {
    return false; // empty or non-JSON body means the safe default
  }
}
