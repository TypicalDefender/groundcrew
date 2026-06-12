/**
 * Shared plumbing for the deck's control endpoints: task-id validation and
 * uniform structured responses, so every action handler reads identically.
 */

import { isPlainTaskId } from "@clipboard-health/groundcrew";

import { restoreOperatorDirectory } from "@/lib/crewEnvironment";

export function ok(extra: Record<string, unknown> = {}): Response {
  return Response.json({ ok: true, ...extra });
}

export function controlError(status: number, message: string): Response {
  return Response.json({ ok: false, error: message }, { status });
}

interface TaskRouteContext {
  params: Promise<{ task: string }>;
}

type TaskRouteHandler = (request: Request, context: TaskRouteContext) => Promise<Response>;

/**
 * Build a POST handler for one task action with the shared guards: valid
 * task id, operator cwd restored, and thrown command errors mapped to a
 * structured 409 (the command refused or could not complete; the message
 * says why).
 */
export function createTaskActionRoute(
  action: (task: string, request: Request) => Promise<Response>,
): TaskRouteHandler {
  return async (request, context) => {
    const { task: rawTask } = await context.params;
    const task = rawTask.toLowerCase();
    if (!isPlainTaskId(task)) {
      return controlError(400, `invalid task id: ${rawTask}`);
    }
    restoreOperatorDirectory();
    try {
      return await action(task, request);
    } catch (error) {
      return controlError(409, error instanceof Error ? error.message : String(error));
    }
  };
}
