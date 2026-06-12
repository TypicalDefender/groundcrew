import { buildSources, loadConfig, sourcesFromConfig } from "@clipboard-health/groundcrew";

import { restoreOperatorDirectory } from "@/lib/crewEnvironment";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    restoreOperatorDirectory();
    const config = await loadConfig();
    const sources = await buildSources(sourcesFromConfig(config), { globalConfig: config });
    return Response.json({
      sources: sources.map((source) => ({
        name: source.name,
        supportsCreate: source.createTask !== undefined,
      })),
    });
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
