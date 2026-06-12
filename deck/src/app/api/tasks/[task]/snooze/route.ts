import { loadConfig, parseSnoozeUntil, recordTaskSnooze } from "@clipboard-health/groundcrew";

import { controlError, createTaskActionRoute, ok } from "@/lib/controlRoute";

export const dynamic = "force-dynamic";

interface SnoozeBody {
  until?: string;
  clear?: boolean;
}

/** `{until: "2h" | ISO}` to hold the task, `{clear: true}` to release it. */
async function readBody(request: Request): Promise<SnoozeBody | undefined> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  const body: SnoozeBody = {};
  if ("until" in parsed) {
    if (typeof parsed.until !== "string" || parsed.until.trim().length === 0) {
      return undefined;
    }
    body.until = parsed.until;
  }
  if ("clear" in parsed) {
    if (parsed.clear !== true) {
      return undefined;
    }
    body.clear = true;
  }
  if ((body.clear === true) === (body.until !== undefined)) {
    return undefined;
  }
  return body;
}

export const POST = createTaskActionRoute(async (task, request) => {
  const body = await readBody(request);
  if (body === undefined) {
    return controlError(
      400,
      "body must be JSON with exactly one of `until` (string) or `clear: true`",
    );
  }
  const config = await loadConfig();

  if (body.clear === true) {
    const cleared = recordTaskSnooze({ config, task });
    if (cleared === undefined) {
      return controlError(404, `no run state for task ${task}`);
    }
    return ok();
  }

  let until: Date;
  try {
    until = parseSnoozeUntil(body.until ?? "", new Date());
  } catch (error) {
    return controlError(400, error instanceof Error ? error.message : String(error));
  }
  const state = recordTaskSnooze({ config, task, until });
  if (state === undefined) {
    return controlError(404, `no run state for task ${task}`);
  }
  return ok({ snoozedUntil: state.snoozedUntil });
});
