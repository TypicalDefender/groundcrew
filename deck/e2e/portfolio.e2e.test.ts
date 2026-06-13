import { expect, test } from "@playwright/test";

test.describe.serial("portfolio view", () => {
  test("lists the registered crew with its live fleet", async ({ page }) => {
    await page.goto("/portfolio");

    const section = page.getByLabel("Crew fixture");
    await expect(section).toBeVisible({ timeout: 15_000 });
    await expect(section).toContainText("e2e-001");
    await expect(section).toContainText("Fix login retry race");
    await expect(section).toContainText("e2e-004");
  });

  test("the header navigates between board and portfolio", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Portfolio", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Portfolio" })).toBeVisible();
    await page.getByRole("link", { name: "← Board" }).click();
    await expect(page.getByRole("heading", { name: "Board" })).toBeVisible();
  });
});
