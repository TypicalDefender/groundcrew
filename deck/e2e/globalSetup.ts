/**
 * Seeds the e2e fixture's run states before the suite. The fixture dir is
 * committed (config + todo.txt); the state dir is regenerated each run so
 * tests always start from the same fleet.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  loadConfig,
  recordRunState,
  recordTaskPulse,
  recordTaskPullRequest,
} from "@clipboard-health/groundcrew";

const FIXTURE_DIR = path.join(import.meta.dirname, "fixture");

const TODO_LINES = `Fix login retry race id:E2E-001 repo:repo-a agent:claude status:in-progress
Say hello id:E2E-002 repo:repo-a agent:claude status:todo
Add billing export id:E2E-003 repo:repo-a agent:claude status:in-review
Harden rate limiter id:E2E-004 repo:repo-a agent:codex status:in-review
`;

function shell(command: string, cwd: string): void {
  execSync(command, { cwd, stdio: "ignore" });
}

export default async function globalSetup(): Promise<void> {
  rmSync(path.join(FIXTURE_DIR, "state"), { recursive: true, force: true });
  // Regenerate the mutable artifacts each run: writebacks flip todo.txt
  // statuses and the round-trip creates/removes worktrees.
  writeFileSync(path.join(FIXTURE_DIR, "todo.txt"), TODO_LINES);
  const repoDir = path.join(FIXTURE_DIR, "project", "repo-a");
  rmSync(path.join(FIXTURE_DIR, "project"), { recursive: true, force: true });
  mkdirSync(repoDir, { recursive: true });
  shell("git init -q -b main", repoDir);
  shell(
    "git -c user.name=e2e -c user.email=e2e@example.invalid commit -q --allow-empty -m init",
    repoDir,
  );
  // The launch path fetches origin/<defaultBranch>; point origin at the repo itself.
  shell("git remote add origin .", repoDir);
  shell("git fetch -q origin main", repoDir);
  try {
    shell("tmux kill-window -t groundcrew:e2e-002", FIXTURE_DIR);
  } catch {
    // no leftover window — fine
  }
  if (!existsSync(repoDir)) {
    throw new Error("fixture repo init failed");
  }
  process.chdir(FIXTURE_DIR);
  // oxlint-disable-next-line node/no-process-env -- same channel the deck server uses
  process.env.GROUNDCREW_CONFIG = path.join(FIXTURE_DIR, "crew.config.ts");
  const config = await loadConfig();

  function seed(task: string, agent: string): void {
    recordRunState({
      config,
      state: {
        task,
        repository: "repo-a",
        agent,
        worktreeDir: path.join(FIXTURE_DIR, "project", `repo-a-${task}`),
        branchName: `dev-${task}`,
        workspaceName: task,
        state: "running",
      },
    });
  }

  seed("e2e-001", "claude");
  recordTaskPulse({ config, task: "e2e-001", pulse: "active" });

  seed("e2e-003", "claude");
  recordTaskPulse({ config, task: "e2e-003", pulse: "ready" });
  recordTaskPullRequest({
    config,
    task: "e2e-003",
    prUrl: "https://github.com/acme/repo-a/pull/31",
    prNumber: 31,
    ci: "passing",
    review: "pending",
  });

  seed("e2e-004", "codex");
  recordTaskPulse({ config, task: "e2e-004", pulse: "ready" });
  recordTaskPullRequest({
    config,
    task: "e2e-004",
    prUrl: "https://github.com/acme/repo-a/pull/32",
    prNumber: 32,
    ci: "failing",
    review: "changes-requested",
  });
}
