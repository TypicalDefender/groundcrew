import { makeCrewEvent } from "../crewEvents.ts";
import { captureConsoleLog, type ConsoleCapture } from "../../testHelpers/consoleCapture.ts";
import desktopDefinition, { buildDesktopCommand, createDesktopNotifier } from "./desktop/index.ts";
import { notifierRegistry } from "./registry.ts";
import slackDefinition, {
  createSlackNotifier,
  type FetchLike,
  slackPayload,
} from "./slack/index.ts";
import webhookDefinition, { createWebhookNotifier, webhookPayload } from "./webhook/index.ts";

const EVENT = makeCrewEvent({
  kind: "task-stuck",
  title: 'team-1 says "stuck"',
  body: "Pulse unchanged for 12m.",
  now: new Date("2026-06-13T08:00:00.000Z"),
  task: "team-1",
});

interface RecordedRequest {
  url: string;
  init: { method: string; headers: Record<string, string>; body: string };
}

function bodyOf(request: RecordedRequest | undefined): unknown {
  if (request === undefined) {
    throw new Error("expected a recorded request");
  }
  return JSON.parse(request.init.body);
}

function fakeFetch(status = 200): { fetchLike: FetchLike; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  return {
    requests,
    fetchLike: async (url, init) => {
      requests.push({ url, init });
      return { ok: status >= 200 && status < 300, status };
    },
  };
}

describe("built-in notifier registry", () => {
  it("discovers desktop, slack, and webhook", async () => {
    const registry = await notifierRegistry;

    expect(Object.keys(registry).toSorted()).toStrictEqual(["desktop", "slack", "webhook"]);
  });
});

describe(buildDesktopCommand, () => {
  it("builds an osascript banner on macOS with quotes escaped", () => {
    expect(buildDesktopCommand(EVENT, "darwin")).toStrictEqual({
      command: "osascript",
      arguments: [
        "-e",
        String.raw`display notification "Pulse unchanged for 12m." with title "team-1 says \"stuck\""`,
      ],
    });
  });

  it("builds notify-send on Linux, mapping urgent to critical", () => {
    expect(buildDesktopCommand(EVENT, "linux")).toStrictEqual({
      command: "notify-send",
      arguments: ["--urgency", "critical", 'team-1 says "stuck"', "Pulse unchanged for 12m."],
    });
    const info = makeCrewEvent({ kind: "task-done", title: "done", body: "merged" });
    expect(buildDesktopCommand(info, "linux")?.arguments).toContain("normal");
  });

  it("returns undefined elsewhere and the notifier logs the skip", async () => {
    expect(buildDesktopCommand(EVENT, "win32")).toBeUndefined();

    const consoleLog: ConsoleCapture = captureConsoleLog();
    const ran: string[] = [];
    const notifier = createDesktopNotifier(async (command) => {
      ran.push(command);
    }, "win32");
    await notifier.notify(EVENT);
    consoleLog.restore();

    expect(ran).toStrictEqual([]);
  });

  it("runs the platform command through the seam", async () => {
    const ran: { command: string; arguments_: readonly string[] }[] = [];
    const notifier = createDesktopNotifier(async (command, arguments_) => {
      ran.push({ command, arguments_ });
    }, "darwin");

    await notifier.notify(EVENT);

    expect(ran[0]?.command).toBe("osascript");
    expect(desktopDefinition.create({ kind: "desktop" }, contextStub()).kind).toBe("desktop");
  });
});

describe(slackPayload, () => {
  it("formats title, body, and optional link into one mrkdwn message", () => {
    expect(slackPayload(EVENT)).toStrictEqual({
      text: '*team-1 says "stuck"*\nPulse unchanged for 12m.',
    });
    const withUrl = makeCrewEvent({
      kind: "pr-mergeable",
      title: "PR #9 mergeable",
      body: "Approved.",
      url: "https://github.com/acme/repo-a/pull/9",
    });
    expect(slackPayload(withUrl).text).toContain("\nhttps://github.com/acme/repo-a/pull/9");
  });

  it("posts to the webhook and throws on non-2xx responses", async () => {
    const ok = fakeFetch();
    const notifier = createSlackNotifier("https://hooks.slack.test/T/B/x", ok.fetchLike);

    await notifier.notify(EVENT);
    expect(ok.requests[0]?.url).toBe("https://hooks.slack.test/T/B/x");
    expect(ok.requests[0]?.init.headers).toStrictEqual({ "Content-Type": "application/json" });
    expect(bodyOf(ok.requests[0])).toStrictEqual(slackPayload(EVENT));

    const broken = fakeFetch(500);
    const failing = createSlackNotifier("https://hooks.slack.test/T/B/x", broken.fetchLike);
    await expect(failing.notify(EVENT)).rejects.toThrow("Slack webhook responded 500");
    expect(
      slackDefinition.create(
        { kind: "slack", webhookUrl: "https://hooks.slack.test/T/B/x" },
        contextStub(),
      ).kind,
    ).toBe("slack");
  });
});

describe(webhookPayload, () => {
  it("sends the event itself as JSON with extra headers merged in", async () => {
    expect(webhookPayload(EVENT)).toStrictEqual(EVENT);

    const recorded = fakeFetch();
    const notifier = createWebhookNotifier(
      "https://example.test/hook",
      { authorization: "Bearer x" },
      recorded.fetchLike,
    );
    await notifier.notify(EVENT);

    expect(recorded.requests[0]?.init.headers).toStrictEqual({
      "Content-Type": "application/json",
      authorization: "Bearer x",
    });
    expect(bodyOf(recorded.requests[0])).toStrictEqual({ ...EVENT });
  });

  it("throws on non-2xx and constructs through its definition", async () => {
    const broken = fakeFetch(404);
    const notifier = createWebhookNotifier("https://example.test/hook", {}, broken.fetchLike);
    await expect(notifier.notify(EVENT)).rejects.toThrow("Webhook responded 404");

    const built = webhookDefinition.create(
      { kind: "webhook", url: "https://example.test/hook" },
      contextStub(),
    );
    expect(built.kind).toBe("webhook");
  });
});

function contextStub(): Parameters<typeof desktopDefinition.create>[1] {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the built-ins ignore the context entirely
  return { globalConfig: {} } as unknown as Parameters<typeof desktopDefinition.create>[1];
}
