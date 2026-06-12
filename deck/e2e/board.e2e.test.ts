import { expect, test } from "@playwright/test";

test("board renders the rail, all four columns, and live cards", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Board" })).toBeVisible();
  await Promise.all(
    ["Todo", "In Progress", "In Review", "Done"].map(async (column) => {
      await expect(page.getByRole("heading", { name: column, exact: true })).toBeVisible();
    }),
  );
  await expect(page.getByLabel("Needs you")).toBeVisible();
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
  await expect(
    drawer.getByText("/tmp/crew-fleet-smoke/project/repo-a-gc-20260612-006"),
  ).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
});

test("the SSE stream keeps the board updating without a reload", async ({ page }) => {
  await page.goto("/");

  const updated = page.getByText(/updated/);
  await expect(updated).toBeVisible();
  const first = await updated.textContent();
  await expect(async () => {
    expect(await updated.textContent()).not.toBe(first);
  }).toPass({ timeout: 15_000 });
});
