import path from "node:path";

import { defineConfig } from "@playwright/test";

/**
 * E2E against a real deck server booted from the committed fixture in
 * e2e/fixture (todo-txt source + seeded run states via globalSetup).
 */
const FIXTURE_DIR = path.join(import.meta.dirname, "e2e", "fixture");

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.test\.ts/,
  // One worker: the suites share a real tmux server, a real state dir, and
  // the terminal bridge's single writer seat — parallel files contend.
  workers: 1,
  timeout: 30_000,
  globalSetup: "./e2e/globalSetup.ts",
  use: {
    baseURL: "http://localhost:4411",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npx next start --port 4411",
    url: "http://localhost:4411",
    reuseExistingServer: false,
    cwd: import.meta.dirname,
    env: {
      GROUNDCREW_CONFIG: path.join(FIXTURE_DIR, "crew.config.ts"),
      GROUNDCREW_PROJECT_CWD: FIXTURE_DIR,
      // Hermetic config registry for the portfolio view.
      XDG_STATE_HOME: path.join(FIXTURE_DIR, "xdg-state"),
    },
  },
});
