import { defineConfig } from "@playwright/test";

/**
 * E2E suite against a running deck. Start one first, e.g.:
 *   cd <fixture dir> && crew deck --no-build
 * or point DECK_E2E_URL elsewhere.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.test\.ts/,
  timeout: 30_000,
  use: {
    // oxlint-disable-next-line node/no-process-env -- standard E2E target override
    baseURL: process.env.DECK_E2E_URL ?? "http://localhost:4400",
  },
});
