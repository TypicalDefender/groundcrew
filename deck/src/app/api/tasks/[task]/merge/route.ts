import {
  findPullRequestsForBranch,
  loadConfig,
  mergePullRequest,
  readRunState,
} from "@clipboard-health/groundcrew";

import { controlError, createTaskActionRoute, ok } from "@/lib/controlRoute";

export const dynamic = "force-dynamic";

export const POST = createTaskActionRoute(async (task) => {
  const config = await loadConfig();
  const runState = readRunState(config, task);
  if (runState?.prUrl === undefined) {
    return controlError(404, `no pull request recorded for task ${task}`);
  }
  // Merge against fresh facts, never the recorded snapshot: re-fetch the
  // PR and require it to still be the one the run state points at.
  const pullRequests = await findPullRequestsForBranch({
    cwd: runState.worktreeDir,
    branchName: runState.branchName,
  });
  const pullRequest = pullRequests.find((pr) => pr.url === runState.prUrl);
  if (pullRequest === undefined) {
    return controlError(409, `could not confirm the pull request for ${task} via gh`);
  }
  const result = await mergePullRequest({ cwd: runState.worktreeDir, pullRequest });
  if (result.outcome === "merged") {
    return ok({ merged: pullRequest.number });
  }
  return controlError(409, result.reason);
});
