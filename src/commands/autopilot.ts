/**
 * Autopilot — automatic follow-ups, run each watch tick after the
 * reviewer. A pure `decideFollowUps` turns the fleet's run states into
 * typed actions; `createAutopilot` executes them through injectable seams
 * (workspace sendText, PR lookup/merge, run-state bookkeeping).
 *
 * Guard rails: a task whose pulse is `active` is never nudged or flagged;
 * a task gets at most one action per tick (merge > CI nudge > review
 * nudge > stuck); attempt counters and delivery memos live on the run
 * state so budgets survive restarts.
 */

import { type AutopilotConfig, DEFAULT_AUTOPILOT, type ResolvedConfig } from "../lib/config.ts";
import {
  fetchReviewComments,
  findPullRequestsForBranch,
  isMergeablePullRequest,
  mergePullRequest,
  type MergePullRequestResult,
  type PullRequestSummary,
} from "../lib/pullRequests.ts";
import { buildCiFailureNudge } from "../lib/ciLogs.ts";
import { emitCrewEvent } from "../lib/crewEventBus.ts";
import {
  type AutopilotActivityEvent,
  recordTaskAutopilot,
  type RunState,
} from "../lib/runState.ts";
import { formatReviewCommentsNudge, selectUndeliveredComments } from "../lib/reviewNudges.ts";
import { errorMessage, log } from "../lib/util.ts";
import { workspaces, type WorkspaceSendResult } from "../lib/workspaces.ts";

const MILLISECONDS_PER_MINUTE = 60_000;
const MAX_ACTIVITY_EVENTS = 10;

export type FollowUpAction =
  | { kind: "merge"; task: string; prUrl: string; branchName: string; worktreeDir: string }
  | {
      kind: "nudge-ci-failure";
      task: string;
      prUrl: string;
      workspaceName: string;
      worktreeDir: string;
      branchName: string;
      attempt: number;
    }
  | {
      kind: "nudge-review-comments";
      task: string;
      prUrl: string;
      workspaceName: string;
      worktreeDir: string;
      deliveredCommentIds: readonly string[];
    }
  | { kind: "flag-stuck"; task: string; stuckForMinutes: number };

export interface DecideFollowUpsInput {
  /** The fleet as the orchestrator sees it this tick. */
  runStates: readonly RunState[];
  /** Live workspace names from this tick's probe. */
  liveNames: ReadonlySet<string>;
  config: Pick<ResolvedConfig, "autopilot">;
  now: Date;
}

function autopilotFor(config: Pick<ResolvedConfig, "autopilot">): AutopilotConfig {
  return config.autopilot ?? DEFAULT_AUTOPILOT;
}

function minutesSince(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / MILLISECONDS_PER_MINUTE;
}

function decideMerge(state: RunState, autopilot: AutopilotConfig): FollowUpAction | undefined {
  if (
    autopilot.autoMerge.enabled &&
    state.prUrl !== undefined &&
    state.ci === "passing" &&
    state.review === "approved"
  ) {
    return {
      kind: "merge",
      task: state.task,
      prUrl: state.prUrl,
      branchName: state.branchName,
      worktreeDir: state.worktreeDir,
    };
  }
  return undefined;
}

function decideCiNudge(state: RunState, autopilot: AutopilotConfig): FollowUpAction | undefined {
  if (
    autopilot.ciFailure.enabled &&
    state.prUrl !== undefined &&
    state.ci === "failing" &&
    (state.ciNudgeAttempts ?? 0) < autopilot.ciFailure.maxAttempts
  ) {
    return {
      kind: "nudge-ci-failure",
      task: state.task,
      prUrl: state.prUrl,
      workspaceName: state.workspaceName,
      worktreeDir: state.worktreeDir,
      branchName: state.branchName,
      attempt: (state.ciNudgeAttempts ?? 0) + 1,
    };
  }
  return undefined;
}

function decideReviewNudge(
  state: RunState,
  autopilot: AutopilotConfig,
): FollowUpAction | undefined {
  if (
    autopilot.reviewComments.enabled &&
    state.prUrl !== undefined &&
    state.review === "changes-requested"
  ) {
    return {
      kind: "nudge-review-comments",
      task: state.task,
      prUrl: state.prUrl,
      workspaceName: state.workspaceName,
      worktreeDir: state.worktreeDir,
      deliveredCommentIds: state.nudgedCommentIds ?? [],
    };
  }
  return undefined;
}

function decideStuck(
  state: RunState,
  autopilot: AutopilotConfig,
  now: Date,
): FollowUpAction | undefined {
  if (
    autopilot.stuck.enabled &&
    state.pulse !== undefined &&
    state.pulse !== "gone" &&
    state.pulseChangedAt !== undefined &&
    state.stuckSince === undefined &&
    minutesSince(state.pulseChangedAt, now) >= autopilot.stuck.thresholdMinutes
  ) {
    return {
      kind: "flag-stuck",
      task: state.task,
      stuckForMinutes: Math.floor(minutesSince(state.pulseChangedAt, now)),
    };
  }
  return undefined;
}

function decideForTask(
  state: RunState,
  autopilot: AutopilotConfig,
  liveNames: ReadonlySet<string>,
  now: Date,
): FollowUpAction | undefined {
  // Per-task kill switch (deck toggle / recordTaskAutopilot).
  if (state.autopilotEnabled === false) {
    return undefined;
  }
  const merge = decideMerge(state, autopilot);
  if (merge !== undefined) {
    return merge;
  }
  // Nudges and stuck detection talk to (or about) the live agent; an
  // `active` pulse means it is mid-thought — leave it alone.
  if (!liveNames.has(state.workspaceName) || state.pulse === "active") {
    return undefined;
  }
  return (
    decideCiNudge(state, autopilot) ??
    decideReviewNudge(state, autopilot) ??
    decideStuck(state, autopilot, now)
  );
}

/** Pure decision pass: at most one action per task, in priority order. */
export function decideFollowUps(input: DecideFollowUpsInput): FollowUpAction[] {
  const autopilot = autopilotFor(input.config);
  const actions: FollowUpAction[] = [];
  for (const state of input.runStates) {
    const action = decideForTask(state, autopilot, input.liveNames, input.now);
    if (action !== undefined) {
      actions.push(action);
    }
  }
  return actions;
}

/**
 * Cheap pre-probe check: could any run state possibly produce an action
 * (or need memo housekeeping)? Lets the tick skip the workspace shell-out
 * on quiet fleets.
 */
export function hasAutopilotCandidates(
  runStates: readonly RunState[],
  config: Pick<ResolvedConfig, "autopilot">,
): boolean {
  const autopilot = autopilotFor(config);
  return runStates.some(
    (state) =>
      (autopilot.autoMerge.enabled && state.ci === "passing" && state.review === "approved") ||
      (autopilot.ciFailure.enabled && state.ci === "failing") ||
      (autopilot.reviewComments.enabled && state.review === "changes-requested") ||
      (autopilot.stuck.enabled && state.pulseChangedAt !== undefined) ||
      state.ciNudgeAttempts !== undefined ||
      state.reviewNudgedAt !== undefined ||
      state.stuckSince !== undefined,
  );
}

/**
 * Memo housekeeping, separate from actions: counters and flags reset when
 * the condition that created them has passed.
 */
type AutopilotMemoKey = "ciNudgeAttempts" | "reviewNudgedAt" | "nudgedCommentIds" | "stuckSince";

export function staleMemoClears(state: RunState): AutopilotMemoKey[] {
  const clears: AutopilotMemoKey[] = [];
  if (state.ciNudgeAttempts !== undefined && state.ci !== "failing") {
    clears.push("ciNudgeAttempts");
  }
  if (state.reviewNudgedAt !== undefined && state.review !== "changes-requested") {
    clears.push("reviewNudgedAt");
  }
  if (state.nudgedCommentIds !== undefined && state.review !== "changes-requested") {
    clears.push("nudgedCommentIds");
  }
  if (state.stuckSince !== undefined && state.pulse === "active") {
    clears.push("stuckSince");
  }
  return clears;
}

/** Seam bundle so tests drive the executor without gh/tmux. */
export interface AutopilotDeps {
  sendText: (
    config: ResolvedConfig,
    name: string,
    text: string,
    signal?: AbortSignal,
  ) => Promise<WorkspaceSendResult>;
  findPullRequests: typeof findPullRequestsForBranch;
  merge: (input: {
    cwd: string;
    pullRequest: PullRequestSummary;
    signal?: AbortSignal;
  }) => Promise<MergePullRequestResult>;
  /** Nudge body for a failing PR; the default folds in a CI log excerpt. */
  buildCiFailureNudge: (
    action: Extract<FollowUpAction, { kind: "nudge-ci-failure" }>,
    signal?: AbortSignal,
  ) => string | Promise<string>;
  /** Unresolved review threads for the PR; the nudge lists the new ones. */
  fetchComments: typeof fetchReviewComments;
}

export const DEFAULT_AUTOPILOT_DEPS: AutopilotDeps = {
  sendText: workspaces.sendText,
  findPullRequests: findPullRequestsForBranch,
  merge: mergePullRequest,
  buildCiFailureNudge: async (action, signal) =>
    await buildCiFailureNudge({
      prUrl: action.prUrl,
      worktreeDir: action.worktreeDir,
      branchName: action.branchName,
      ...(signal === undefined ? {} : { signal }),
    }),
  fetchComments: fetchReviewComments,
};

export interface Autopilot {
  runOnce: (arguments_: {
    runStates: readonly RunState[];
    signal?: AbortSignal;
    now?: Date;
  }) => Promise<void>;
}

export function createAutopilot(
  dependencies: { config: ResolvedConfig },
  deps: AutopilotDeps = DEFAULT_AUTOPILOT_DEPS,
): Autopilot {
  const { config } = dependencies;

  function recordActivity(
    task: string,
    states: readonly RunState[],
    event: Omit<AutopilotActivityEvent, "at">,
    now: Date,
  ): void {
    const previous = states.find((state) => state.task === task)?.autopilotActivity ?? [];
    const trail = [{ at: now.toISOString(), ...event }, ...previous].slice(0, MAX_ACTIVITY_EVENTS);
    recordTaskAutopilot({ config, task, set: { autopilotActivity: trail } });
  }

  async function executeMerge(
    action: Extract<FollowUpAction, { kind: "merge" }>,
    states: readonly RunState[],
    now: Date,
  ): Promise<void> {
    const summaries = await deps.findPullRequests({
      cwd: action.worktreeDir,
      branchName: action.branchName,
    });
    const pullRequest = summaries.find((summary) => summary.url === action.prUrl);
    if (pullRequest === undefined || !isMergeablePullRequest(pullRequest)) {
      log(`Autopilot: ${action.task} no longer looks mergeable; skipping merge`);
      return;
    }
    const result = await deps.merge({ cwd: action.worktreeDir, pullRequest });
    if (result.outcome === "merged") {
      log(`Autopilot: merged ${action.prUrl} for ${action.task}`);
      recordActivity(action.task, states, { kind: "merge", detail: `merged ${action.prUrl}` }, now);
      return;
    }
    log(`Autopilot: merge of ${action.prUrl} ${result.outcome}: ${result.reason}`);
    recordActivity(
      action.task,
      states,
      { kind: "merge", detail: `merge ${result.outcome}: ${result.reason}` },
      now,
    );
  }

  async function executeNudge(
    action: Extract<FollowUpAction, { kind: "nudge-ci-failure" | "nudge-review-comments" }>,
    text: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const result = await deps.sendText(config, action.workspaceName, text, signal);
    if (result.kind === "sent") {
      return true;
    }
    log(`Autopilot: could not deliver nudge to ${action.task} (${result.kind})`);
    return false;
  }

  async function executeReviewNudge(
    action: Extract<FollowUpAction, { kind: "nudge-review-comments" }>,
    states: readonly RunState[],
    now: Date,
    signal?: AbortSignal,
  ): Promise<void> {
    const comments = await deps.fetchComments({
      cwd: action.worktreeDir,
      prUrl: action.prUrl,
      ...(signal === undefined ? {} : { signal }),
    });
    const fresh = selectUndeliveredComments(comments, action.deliveredCommentIds);
    if (fresh.length === 0) {
      return;
    }
    log(`Autopilot: nudging ${action.task} with ${fresh.length} unresolved review comment(s)`);
    const nudge = formatReviewCommentsNudge({ prUrl: action.prUrl, comments: fresh });
    if (await executeNudge(action, nudge, signal)) {
      recordTaskAutopilot({
        config,
        task: action.task,
        set: {
          reviewNudgedAt: now.toISOString(),
          nudgedCommentIds: [...action.deliveredCommentIds, ...fresh.map((c) => c.id)],
        },
      });
      recordActivity(
        action.task,
        states,
        {
          kind: "nudge-review-comments",
          detail: `delivered ${fresh.length} review comment(s)`,
        },
        now,
      );
    }
  }

  async function execute(
    action: FollowUpAction,
    states: readonly RunState[],
    now: Date,
    signal?: AbortSignal,
  ): Promise<void> {
    if (action.kind === "merge") {
      await executeMerge(action, states, now);
      return;
    }
    if (action.kind === "nudge-ci-failure") {
      log(`Autopilot: nudging ${action.task} about failing CI (attempt ${action.attempt})`);
      if (await executeNudge(action, await deps.buildCiFailureNudge(action, signal), signal)) {
        recordTaskAutopilot({
          config,
          task: action.task,
          set: { ciNudgeAttempts: action.attempt },
        });
        recordActivity(
          action.task,
          states,
          {
            kind: "nudge-ci-failure",
            detail: `nudged about failing CI (attempt ${action.attempt})`,
          },
          now,
        );
        if (action.attempt >= autopilotFor(config).ciFailure.maxAttempts) {
          await emitCrewEvent({
            kind: "autopilot-exhausted",
            title: `${action.task}: CI nudge budget exhausted`,
            body: `Autopilot nudged ${action.attempt} time(s) and CI is still failing; take a look.`,
            task: action.task,
            url: action.prUrl,
            now,
          });
        }
      }
      return;
    }
    if (action.kind === "nudge-review-comments") {
      await executeReviewNudge(action, states, now, signal);
      return;
    }
    log(
      `Autopilot: ${action.task} looks stuck (pulse unchanged for ${action.stuckForMinutes}m); flagging it`,
    );
    recordTaskAutopilot({ config, task: action.task, set: { stuckSince: now.toISOString() } });
    recordActivity(
      action.task,
      states,
      { kind: "flag-stuck", detail: `pulse unchanged for ${action.stuckForMinutes}m` },
      now,
    );
    await emitCrewEvent({
      kind: "task-stuck",
      title: `${action.task} looks stuck`,
      body: `Pulse unchanged for ${action.stuckForMinutes}m; the agent may need a nudge or a human.`,
      task: action.task,
      now,
    });
  }

  return {
    async runOnce({ runStates, signal, now = new Date() }) {
      // Housekeeping first: stale counters reset even on quiet ticks.
      for (const state of runStates) {
        const clears = staleMemoClears(state);
        if (clears.length > 0) {
          recordTaskAutopilot({ config, task: state.task, clear: clears });
        }
      }
      if (!hasAutopilotCandidates(runStates, config)) {
        return;
      }
      const probe = await workspaces.probe(config, signal);
      const liveNames = probe.kind === "ok" ? probe.names : new Set<string>();
      const actions = decideFollowUps({ runStates, liveNames, config, now });
      for (const action of actions) {
        try {
          // oxlint-disable-next-line no-await-in-loop -- follow-ups run sequentially on purpose
          await execute(action, runStates, now, signal);
        } catch (error) {
          log(`Autopilot: ${action.kind} for ${action.task} failed: ${errorMessage(error)}`);
        }
      }
    },
  };
}
