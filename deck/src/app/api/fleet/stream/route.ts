import { collectFleetSnapshot, loadConfig } from "@clipboard-health/groundcrew";

import { restoreOperatorDirectory } from "@/lib/crewEnvironment";
import { createSnapshotStream, SSE_HEADERS } from "@/lib/snapshotStream";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    restoreOperatorDirectory();
    const config = await loadConfig();
    const stream = createSnapshotStream({
      collect: async () => await collectFleetSnapshot({ config }),
      intervalMilliseconds: config.deck.pollIntervalMilliseconds,
    });
    return new Response(stream, { headers: { ...SSE_HEADERS } });
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
