import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

const RUN_STATE_FILE = path.join(import.meta.dirname, "fixture", "state", "runs", "e2e-003.json");

function snoozedUntil(): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(RUN_STATE_FILE, "utf8"));
    if (typeof parsed === "object" && parsed !== null && "snoozedUntil" in parsed) {
      return typeof parsed.snoozedUntil === "string" ? parsed.snoozedUntil : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

test.describe.serial("per-task snooze", () => {
  test("snooze writes the real run state and unsnooze clears it", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: /Add billing export/ }).click();
    const drawer = page.getByRole("dialog");

    await drawer.getByRole("button", { name: "Snooze", exact: true }).click();
    await drawer.getByRole("menuitem", { name: "1 hour" }).click();
    await expect(page.getByText(/Snoozed \(1 hour\) e2e-003/)).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => snoozedUntil(), { timeout: 5000 }).toBeDefined();

    // The snapshot feed flips the control to Unsnooze and shows the expiry.
    const unsnooze = drawer.getByRole("button", { name: "Unsnooze", exact: true });
    await expect(unsnooze).toBeVisible({ timeout: 10_000 });
    await expect(drawer.getByText("snoozed until")).toBeVisible();

    await unsnooze.click();
    await expect(page.getByText(/Unsnoozed e2e-003/)).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => snoozedUntil(), { timeout: 5000 }).toBeUndefined();
    await expect(drawer.getByRole("button", { name: "Snooze", exact: true })).toBeVisible({
      timeout: 10_000,
    });
  });
});
