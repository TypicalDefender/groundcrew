/**
 * Seeds the e2e fixture's run states before the suite. The fixture dir is
 * committed (config + todo.txt); the state dir is regenerated each run so
 * tests always start from the same fleet.
 */

import { rmSync } from "node:fs";
import path from "node:path";

import {
  loadConfig,
  recordRunState,
  recordTaskPulse,
  recordTaskPullRequest,
} from "@clipboard-health/groundcrew";

const FIXTURE_DIR = path.join(import.meta.dirname, "fixture");

export default async function globalSetup(): Promise<void> {
  rmSync(path.join(FIXTURE_DIR, "state"), { recursive: true, force: true });
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
