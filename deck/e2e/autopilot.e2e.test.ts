import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

const RUN_STATE_FILE = path.join(import.meta.dirname, "fixture", "state", "runs", "e2e-003.json");

function autopilotEnabledOnDisk(): boolean | undefined {
  const parsed: unknown = JSON.parse(readFileSync(RUN_STATE_FILE, "utf8"));
  if (typeof parsed === "object" && parsed !== null && "autopilotEnabled" in parsed) {
    return typeof parsed.autopilotEnabled === "boolean" ? parsed.autopilotEnabled : undefined;
  }
  return undefined;
}

test.describe.serial("autopilot deck integration", () => {
  test("the global feed lists the seeded autopilot action", async ({ page }) => {
    await page.goto("/");

    const feed = page.getByLabel("Autopilot activity");
    await expect(feed).toBeVisible();
    await expect(feed).toContainText("e2e-004");
    await expect(feed).toContainText("nudged about failing CI (attempt 1)");
  });

  test("the per-task toggle round-trips through the real run state", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Add billing export/ }).click();
    const drawer = page.getByRole("dialog");

    const turnOff = drawer.getByRole("button", { name: "Turn autopilot off" });
    await expect(turnOff).toBeVisible();
    await turnOff.click();
    await expect(page.getByText(/Autopilot off for e2e-003/)).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => autopilotEnabledOnDisk(), { timeout: 5000 }).toBe(false);

    const turnOn = drawer.getByRole("button", { name: "Turn autopilot on" });
    await expect(turnOn).toBeVisible({ timeout: 10_000 });
    await turnOn.click();
    await expect(page.getByText(/Autopilot on for e2e-003/)).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => autopilotEnabledOnDisk(), { timeout: 5000 }).toBeUndefined();
  });

  test("the drawer shows the CI nudge budget for the seeded task", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Harden rate limiter/ }).click();
    const drawer = page.getByRole("dialog");

    await expect(drawer.getByLabel("Autopilot activity for e2e-004")).toContainText(
      "nudged about failing CI (attempt 1)",
    );
  });
});
