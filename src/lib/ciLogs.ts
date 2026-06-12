/**
 * CI log excerpting for autopilot's failing-CI nudges: find the newest
 * failed workflow run for the task's branch, pull its failed-step logs
 * (`gh run view --log-failed`), and fold the tail into a prompt that tells
 * the agent what broke and what to do. Every step degrades to a generic
 * nudge — a missing run, a gh hiccup, or empty logs must never block the
 * nudge itself.
 */

import { runCommandAsync } from "./commandRunner.ts";

const DEFAULT_MAX_EXCERPT_LINES = 60;
const GH_TIMEOUT_MS = 30_000;

/** Minimal command seam: returns stdout, throws on failure. */
export type CiCommandRunner = (
  command: string,
  arguments_: readonly string[],
  options: { cwd: string; signal?: AbortSignal; timeoutMs?: number },
) => Promise<string>;

export interface FailingRunLog {
  workflowName: string;
  log: string;
}

export interface FetchFailingRunLogInput {
  cwd: string;
  branchName: string;
  signal?: AbortSignal;
  run?: CiCommandRunner;
}

/** Newest failed run's failed-step logs for the branch, if gh can see one. */
export async function fetchFailingRunLog(
  input: FetchFailingRunLogInput,
): Promise<FailingRunLog | undefined> {
  const { cwd, branchName, signal, run = runCommandAsync } = input;
  const options = { cwd, timeoutMs: GH_TIMEOUT_MS, ...(signal === undefined ? {} : { signal }) };
  try {
    const listed = await run(
      "gh",
      [
        "run",
        "list",
        "--branch",
        branchName,
        "--status",
        "failure",
        "--limit",
        "1",
        "--json",
        "databaseId,workflowName",
      ],
      options,
    );
    const runs: unknown = JSON.parse(listed);
    if (!isUnknownArray(runs) || runs.length === 0) {
      return undefined;
    }
    const [first] = runs;
    if (
      typeof first !== "object" ||
      first === null ||
      !("databaseId" in first) ||
      typeof first.databaseId !== "number"
    ) {
      return undefined;
    }
    const workflowName =
      "workflowName" in first && typeof first.workflowName === "string" ? first.workflowName : "CI";
    const log = await run("gh", ["run", "view", String(first.databaseId), "--log-failed"], options);
    return { workflowName, log };
  } catch {
    return undefined;
  }
}

// Array.isArray narrows `unknown` to `any[]`; this keeps elements unknown.
function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/** Keep the tail of the log — failures explain themselves at the end. */
export function excerptLastLines(log: string, maxLines = DEFAULT_MAX_EXCERPT_LINES): string {
  const lines = log.replaceAll("\r\n", "\n").split("\n");
  while (lines.length > 0 && lines.at(-1)?.trim() === "") {
    lines.pop();
  }
  if (lines.length <= maxLines) {
    return lines.join("\n");
  }
  const kept = lines.slice(-maxLines);
  return [`… (${lines.length - maxLines} earlier lines truncated)`, ...kept].join("\n");
}

export interface FormatCiFailureNudgeInput {
  prUrl: string;
  /** Omitted when no failed run (or no logs) could be found. */
  failingRun?: FailingRunLog;
  maxLines?: number;
}

/** The nudge body: what failed, the log tail, and what to do about it. */
export function formatCiFailureNudge(input: FormatCiFailureNudgeInput): string {
  const { prUrl, failingRun, maxLines } = input;
  if (failingRun === undefined || failingRun.log.trim() === "") {
    return [
      `CI is failing on your pull request (${prUrl}).`,
      "Please look at the failing checks, fix the problems, and push an update.",
    ].join(" ");
  }
  return [
    `CI is failing on your pull request (${prUrl}).`,
    `Failing workflow: ${failingRun.workflowName}. Log excerpt from the failed steps:`,
    "",
    excerptLastLines(failingRun.log, maxLines),
    "",
    "Please fix these failures and push an update to the same branch.",
  ].join("\n");
}

export interface BuildCiFailureNudgeInput {
  prUrl: string;
  worktreeDir: string;
  branchName: string;
  signal?: AbortSignal;
  run?: CiCommandRunner;
  maxLines?: number;
}

/** Fetch + format in one step; always resolves to a usable nudge body. */
export async function buildCiFailureNudge(input: BuildCiFailureNudgeInput): Promise<string> {
  const failingRun = await fetchFailingRunLog({
    cwd: input.worktreeDir,
    branchName: input.branchName,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.run === undefined ? {} : { run: input.run }),
  });
  return formatCiFailureNudge({
    prUrl: input.prUrl,
    ...(failingRun === undefined ? {} : { failingRun }),
    ...(input.maxLines === undefined ? {} : { maxLines: input.maxLines }),
  });
}
