import {
  buildSources,
  type CreateTaskInput,
  loadConfig,
  sourcesFromConfig,
} from "@clipboard-health/groundcrew";

import { controlError, ok } from "@/lib/controlRoute";
import { restoreOperatorDirectory } from "@/lib/crewEnvironment";

export const dynamic = "force-dynamic";

interface DraftTaskBody {
  source: string;
  title: string;
  agent: string;
  repository?: string;
}

/** Create a draft task in a source that supports task creation. */
export async function POST(request: Request): Promise<Response> {
  const body = await readDraft(request);
  if (body === undefined) {
    return controlError(400, "body must be JSON with non-empty source, title, and agent fields");
  }
  restoreOperatorDirectory();
  try {
    const config = await loadConfig();
    const sources = await buildSources(sourcesFromConfig(config), { globalConfig: config });
    const source = sources.find((candidate) => candidate.name === body.source);
    if (source === undefined) {
      return controlError(404, `unknown source: ${body.source}`);
    }
    if (source.createTask === undefined) {
      return controlError(409, `source "${source.name}" does not support task creation`);
    }
    const input: CreateTaskInput = {
      title: body.title,
      agent: body.agent,
      ...(body.repository === undefined ? {} : { repository: body.repository }),
      projects: [],
      contexts: [],
      dependencies: [],
      edit: false,
    };
    const created = await source.createTask(input);
    return ok({ id: created.id });
  } catch (error) {
    return controlError(409, error instanceof Error ? error.message : String(error));
  }
}

async function readDraft(request: Request): Promise<DraftTaskBody | undefined> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- probing untyped request JSON
  const record = parsed as Record<string, unknown>;
  const source = nonEmptyString(record.source);
  const title = nonEmptyString(record.title);
  const agent = nonEmptyString(record.agent);
  const repository = nonEmptyString(record.repository);
  if (source === undefined || title === undefined || agent === undefined) {
    return undefined;
  }
  return { source, title, agent, ...(repository === undefined ? {} : { repository }) };
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
