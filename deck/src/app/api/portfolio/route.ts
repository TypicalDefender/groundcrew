import { collectPortfolioSnapshot } from "@clipboard-health/groundcrew";

import { restoreOperatorDirectory } from "@/lib/crewEnvironment";

export const dynamic = "force-dynamic";

/** Aggregated fleet snapshots for every registered crew config. */
export async function GET(): Promise<Response> {
  restoreOperatorDirectory();
  return Response.json(await collectPortfolioSnapshot());
}
