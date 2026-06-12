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
  timeout: 30_000,
  globalSetup: "./e2e/globalSetup.ts",
  use: {
    baseURL: "http://localhost:4411",
  },
  webServer: {
    command: "npx next start --port 4411",
    url: "http://localhost:4411",
    reuseExistingServer: false,
    cwd: import.meta.dirname,
    env: {
      GROUNDCREW_CONFIG: path.join(FIXTURE_DIR, "crew.config.ts"),
      GROUNDCREW_PROJECT_CWD: FIXTURE_DIR,
    },
  },
});
