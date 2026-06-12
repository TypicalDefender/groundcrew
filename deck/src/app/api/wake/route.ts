import { clearPause, loadConfig } from "@clipboard-health/groundcrew";

import { controlError, ok } from "@/lib/controlRoute";
import { restoreOperatorDirectory } from "@/lib/crewEnvironment";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  restoreOperatorDirectory();
  try {
    const config = await loadConfig();
    return ok({ woke: clearPause({ config }) });
  } catch (error) {
    return controlError(409, error instanceof Error ? error.message : String(error));
  }
}
