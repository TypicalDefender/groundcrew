import { z } from "zod";

import { buildRegistry } from "../adapters/registry.ts";
import { makeCrewEvent } from "../crewEvents.ts";
import type { NotifierContext, NotifierDefinition } from "../notifierDefinition.ts";
import { captureConsoleLog, type ConsoleCapture } from "../../testHelpers/consoleCapture.ts";
import { notifierRegistry } from "./registry.ts";
import {
  buildNotifiers,
  buildNotifiersWith,
  dispatchCrewEvent,
  notificationRouting,
  routeEvent,
} from "./resolve.ts";

interface Delivered {
  kind: string;
  title: string;
}

function testDefinition(
  kind: string,
  delivered: Delivered[],
  options: { failWith?: string } = {},
): NotifierDefinition {
  return {
    kind,
    configSchema: z.object({ kind: z.literal(kind), label: z.string().optional() }),
    create: () => ({
      kind,
      notify: async (event) => {
        if (options.failWith !== undefined) {
          throw new Error(options.failWith);
        }
        delivered.push({ kind, title: event.title });
      },
    }),
  };
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- notifier construction only threads the config through
const CONTEXT = { globalConfig: {} } as unknown as NotifierContext;

describe(buildNotifiersWith, () => {
  it("dispatches each block to its definition and validates the schema", () => {
    const delivered: Delivered[] = [];
    const registry = {
      desktop: testDefinition("desktop", delivered),
      slack: testDefinition("slack", delivered),
    };

    const notifiers = buildNotifiersWith(
      registry,
      [{ kind: "desktop" }, { kind: "slack", label: "ops" }],
      CONTEXT,
    );

    expect(notifiers.map((notifier) => notifier.kind)).toStrictEqual(["desktop", "slack"]);
  });

  it("rejects unknown kinds with the registered list and schema violations loudly", () => {
    const registry = { desktop: testDefinition("desktop", []) };

    expect(() => buildNotifiersWith(registry, [{ kind: "pager" }], CONTEXT)).toThrow(
      'Unknown notifier kind "pager". Registered: desktop',
    );
    expect(() => buildNotifiersWith(registry, [{ kind: "desktop", label: 7 }], CONTEXT)).toThrow(
      /label/,
    );
    expect(() => buildNotifiersWith({}, [{ kind: "desktop" }], CONTEXT)).toThrow(/\(none\)/);
  });
});

describe("notifier registry discovery", () => {
  it("reuses the generic registry builder with kind/directory enforcement", async () => {
    const loaded = await buildRegistry(["desktop"], async () => testDefinition("desktop", []));
    expect(Object.keys(loaded)).toStrictEqual(["desktop"]);

    await expect(
      buildRegistry(["desktop"], async () => testDefinition("slack", [])),
    ).rejects.toThrow(/directory mismatch/);
  });

  it("starts empty until built-in notifier directories land", async () => {
    await expect(notifierRegistry).resolves.toStrictEqual({});
    // The production entry point works against that same empty registry.
    await expect(buildNotifiers([], CONTEXT)).resolves.toStrictEqual([]);
  });
});

describe(routeEvent, () => {
  const delivered: Delivered[] = [];
  const desktop = testDefinition("desktop", delivered).create({ kind: "desktop" }, CONTEXT);
  const slack = testDefinition("slack", delivered).create({ kind: "slack" }, CONTEXT);

  it("routes by priority, treats a missing table as broadcast, and empty lists as silence", () => {
    const routing = { urgent: ["desktop", "slack"], action: ["slack"], info: [] };

    expect(routeEvent("urgent", routing, [desktop, slack])).toStrictEqual([desktop, slack]);
    expect(routeEvent("action", routing, [desktop, slack])).toStrictEqual([slack]);
    expect(routeEvent("info", routing, [desktop, slack])).toStrictEqual([]);
    expect(routeEvent("info", undefined, [desktop, slack])).toStrictEqual([desktop, slack]);
    expect(routeEvent("action", {}, [desktop, slack])).toStrictEqual([]);
  });

  it("exposes the resolved config's routing slice", () => {
    expect(notificationRouting({ notifications: { urgent: ["desktop"] } })).toStrictEqual({
      urgent: ["desktop"],
    });
    expect(notificationRouting({})).toBeUndefined();
  });
});

describe(dispatchCrewEvent, () => {
  let consoleLog: ConsoleCapture;

  beforeEach(() => {
    consoleLog = captureConsoleLog();
  });

  afterEach(() => {
    consoleLog.restore();
  });

  it("fans out to the routed notifiers and isolates failures", async () => {
    const delivered: Delivered[] = [];
    const context = CONTEXT;
    const broken = testDefinition("desktop", delivered, { failWith: "osascript missing" }).create(
      { kind: "desktop" },
      context,
    );
    const healthy = testDefinition("slack", delivered).create({ kind: "slack" }, context);
    const event = makeCrewEvent({
      kind: "task-stuck",
      title: "team-1 looks stuck",
      body: "Pulse unchanged for 12m.",
      now: new Date("2026-06-13T08:00:00.000Z"),
      task: "team-1",
    });

    await dispatchCrewEvent({
      event,
      notifiers: [broken, healthy],
      routing: { urgent: ["desktop", "slack"] },
    });

    expect(event.priority).toBe("urgent");
    expect(delivered).toStrictEqual([{ kind: "slack", title: "team-1 looks stuck" }]);
    expect(consoleLog.output()).toContain(
      "Notifier desktop failed for task-stuck: osascript missing",
    );
  });
});
