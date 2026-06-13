import { clearPause, emitCrewEvent, loadConfig } from "@clipboard-health/groundcrew";

import { controlError, ok } from "@/lib/controlRoute";
import { restoreOperatorDirectory } from "@/lib/crewEnvironment";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  restoreOperatorDirectory();
  try {
    const config = await loadConfig();
    const woke = clearPause({ config });
    if (woke) {
      await emitCrewEvent({
        kind: "crew-woken",
        title: "Crew woken",
        body: "Dispatch, review, and cleanup resume on the next tick.",
      });
    }
    return ok({ woke });
  } catch (error) {
    return controlError(409, error instanceof Error ? error.message : String(error));
  }
}
