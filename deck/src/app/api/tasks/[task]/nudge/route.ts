import { loadConfig, workspaces } from "@clipboard-health/groundcrew";

import { controlError, createTaskActionRoute, ok } from "@/lib/controlRoute";

export const dynamic = "force-dynamic";

export const POST = createTaskActionRoute(async (task, request) => {
  const text = await readText(request);
  if (text === undefined) {
    return controlError(400, "body must be JSON with a non-empty text field");
  }
  const config = await loadConfig();
  const result = await workspaces.sendText(config, task, text);
  if (result.kind === "sent") {
    return ok();
  }
  if (result.kind === "missing") {
    return controlError(404, `no live workspace for task ${task}`);
  }
  return controlError(409, `workspace backend could not deliver the message`);
});

async function readText(request: Request): Promise<string | undefined> {
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null && "text" in body) {
      const { text } = body;
      if (typeof text === "string" && text.trim().length > 0) {
        return text;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}
