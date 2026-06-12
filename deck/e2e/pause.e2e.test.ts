import { existsSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

const PAUSE_FILE = path.join(import.meta.dirname, "fixture", "state", "pause.json");

test.describe.serial("crew pause control", () => {
  test("pause writes the real state file, banner round-trips, wake clears it", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Pause crew", exact: true }).click();
    await page.getByRole("menuitem", { name: "1 hour" }).click();

    const banner = page.getByLabel("Crew paused");
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("Crew paused until");
    await expect.poll(() => existsSync(PAUSE_FILE), { timeout: 5000 }).toBe(true);

    // A fresh page sees the same pause from its own snapshot.
    await page.reload();
    await expect(page.getByLabel("Crew paused")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Wake crew", exact: true }).click();
    await expect(page.getByLabel("Crew paused")).toBeHidden({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Pause crew", exact: true })).toBeVisible();
    await expect.poll(() => existsSync(PAUSE_FILE), { timeout: 5000 }).toBe(false);
  });
});
