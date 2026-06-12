import { collectFleetSnapshot, loadConfig } from "@clipboard-health/groundcrew";

import { restoreOperatorDirectory } from "@/lib/crewEnvironment";

// The snapshot reads live local state; it must never be cached or rendered ahead of time.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    restoreOperatorDirectory();
    const config = await loadConfig();
    const snapshot = await collectFleetSnapshot({ config });
    return Response.json(snapshot);
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
