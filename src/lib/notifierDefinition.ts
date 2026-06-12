/**
 * Shared `NotifierDefinition` shape that every built-in notifier
 * (`src/lib/notifiers/<kind>/index.ts`) default-exports — the notification
 * mirror of `AdapterDefinition`. The runtime registry
 * (`./notifiers/registry.ts`) discovers notifiers by enumerating that
 * directory and reading each module's default export.
 */

import type { z } from "zod";

import type { ResolvedConfig } from "./config.ts";
import type { CrewEvent } from "./crewEvents.ts";

export interface Notifier {
  /** The defining kind; routing matches on it. */
  readonly kind: string;
  notify: (event: CrewEvent) => Promise<void>;
}

export interface NotifierContext {
  readonly globalConfig: ResolvedConfig;
}

export interface NotifierDefinition<TSchema extends z.ZodType = z.ZodType> {
  /** Discriminator used in `notifiers[].kind`. Must equal the directory name. */
  readonly kind: string;
  /** Zod schema for this notifier's config block (`kind` must be `z.literal(kind)`). */
  readonly configSchema: TSchema;
  /** Builds a Notifier from a validated config block and the shared context. */
  readonly create: (config: z.infer<TSchema>, context: NotifierContext) => Notifier;
}
