/**
 * Portfolio aggregation: one snapshot across every registered crew
 * config. Each entry loads its config fresh (no process cache) and
 * collects its fleet; a config that fails to load or collect degrades to
 * an error entry so one broken fleet never hides the others.
 */

import { loadConfigFromPath } from "./config.ts";
import { readConfigRegistry, type RegisteredConfig } from "./configRegistry.ts";
import { collectFleetSnapshot, type FleetSnapshot } from "./fleet.ts";
import { errorMessage } from "./util.ts";

export interface PortfolioEntry {
  path: string;
  name: string;
  snapshot?: FleetSnapshot;
  error?: string;
}

export interface PortfolioSnapshot {
  collectedAt: string;
  entries: PortfolioEntry[];
}

export interface CollectPortfolioInput {
  /** Defaults to the global config registry. */
  configs?: readonly RegisteredConfig[];
  signal?: AbortSignal;
}

export async function collectPortfolioSnapshot(
  input: CollectPortfolioInput = {},
): Promise<PortfolioSnapshot> {
  const configs = input.configs ?? readConfigRegistry();
  const entries = await Promise.all(
    configs.map(async (registered): Promise<PortfolioEntry> => {
      try {
        const config = await loadConfigFromPath(registered.path);
        const snapshot = await collectFleetSnapshot({
          config,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        });
        return { path: registered.path, name: registered.name, snapshot };
      } catch (error) {
        return { path: registered.path, name: registered.name, error: errorMessage(error) };
      }
    }),
  );
  return { collectedAt: new Date().toISOString(), entries };
}
