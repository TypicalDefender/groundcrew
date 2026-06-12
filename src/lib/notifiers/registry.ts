/**
 * Built-in notifier registry — enumerates `src/lib/notifiers/*` at startup,
 * reusing the generic registry builder from the source-adapter registry.
 */

import path from "node:path";

import type { NotifierDefinition } from "../notifierDefinition.ts";
import { buildRegistry, listAdapterDirectories } from "../adapters/registry.ts";

const here = import.meta.dirname;

/* v8 ignore next 7 @preserve -- exercised once built-in notifier directories exist; unit tests inject loaders */
async function defaultImportLoader(directoryName: string): Promise<NotifierDefinition> {
  const modulePath = path.resolve(here, directoryName, "index.js");
  // oxlint-disable-next-line typescript/no-unsafe-assignment -- dynamic import return type is `any`; the contract is enforced by buildRegistry
  const mod: { default: NotifierDefinition } = await import(modulePath);
  return mod.default;
}

/** Production registry, scanned from `src/lib/notifiers/` subdirectories. */
export const notifierRegistry: Promise<Record<string, NotifierDefinition>> = buildRegistry(
  listAdapterDirectories(here),
  defaultImportLoader,
);
