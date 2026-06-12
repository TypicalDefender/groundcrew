import path from "node:path";

import { expect, test } from "@playwright/test";

test("board renders the rail, all four columns, and live cards from the fixture", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Board" })).toBeVisible();
  await Promise.all(
    ["Todo", "In Progress", "In Review", "Done"].map(async (column) => {
      await expect(page.getByRole("heading", { name: column, exact: true })).toBeVisible();
    }),
  );
  await expect(page.getByLabel("Needs you")).toBeVisible();
  await expect(page.getByText("Harden rate limiter")).toBeVisible();
  await expect(page.getByText("live", { exact: true })).toBeVisible();
});

test("clicking a card opens the detail drawer with run state and PR facts", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Harden rate limiter").click();

  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Run state")).toBeVisible();
  await expect(drawer.getByText("Pull request")).toBeVisible();
  await expect(drawer.getByText("#32")).toBeVisible();
  await expect(drawer.getByText("changes-requested")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
});

test("an SSE tick updates a card without reloading the page", async ({ page }) => {
  await page.goto("/");

  const card = page.locator("button", { hasText: "Fix login retry race" });
  await expect(card.getByText("active")).toBeVisible();

  // Flip the task's pulse on disk; the next poll tick must repaint the card.
  const fixtureDir = path.join(import.meta.dirname, "fixture");
  // oxlint-disable-next-line node/no-process-env -- same channel the deck server uses
  process.env.GROUNDCREW_CONFIG = path.join(fixtureDir, "crew.config.ts");
  const { loadConfig, recordTaskPulse } = await import("@clipboard-health/groundcrew");
  const config = await loadConfig();
  recordTaskPulse({ config, task: "e2e-001", pulse: "awaiting-input" });

  await expect(page.getByLabel("Needs you").getByText("Fix login retry race")).toBeVisible({
    timeout: 10_000,
  });
});
