import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

const FIXTURE_DIR = path.join(import.meta.dirname, "fixture");
const WORKTREE_DIR = path.join(FIXTURE_DIR, "project", "repo-a-e2e-002");

function hasTmux(): boolean {
  try {
    execSync("tmux -V", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function paneText(): string {
  try {
    return execSync("tmux capture-pane -p -t groundcrew:e2e-002", { encoding: "utf8" });
  } catch {
    return "";
  }
}

test.describe.serial("controls round-trip", () => {
  test.skip(!hasTmux(), "tmux is required for the workspace round-trip");

  test("start → stop → resume → nudge → cleanup drives real workspace changes", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/");

    // Start the eligible todo; the launch creates a real worktree + window.
    const todoCard = page.getByRole("button", { name: /Say hello/ });
    await todoCard.getByRole("button", { name: "Start" }).click();
    await expect.poll(() => existsSync(WORKTREE_DIR), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => paneText(), { timeout: 20_000 }).toContain("agent ready");

    // Open the drawer and stop the live workspace.
    await page
      .getByRole("button", { name: /Say hello/ })
      .first()
      .click();
    const drawer = page.getByRole("dialog");
    await drawer.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByText(/Stop applied to e2e-002/)).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => paneText(), { timeout: 15_000 }).toBe("");

    // Resume relaunches the agent in the preserved worktree.
    await drawer.getByRole("button", { name: "Resume", exact: true }).click({ timeout: 15_000 });
    await expect(page.getByText(/Resume applied to e2e-002/)).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => paneText(), { timeout: 20_000 }).toContain("agent ready");

    // Nudge: the text must arrive in the real pane.
    await drawer.getByPlaceholder("Type a message for the agent…").fill("status report please");
    await drawer.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Delivered to the agent's pane")).toBeVisible({
      timeout: 15_000,
    });
    await expect.poll(() => paneText(), { timeout: 15_000 }).toContain("status report please");

    // Cleanup is destructive: confirm dialog, then the worktree disappears.
    await drawer.getByRole("button", { name: "Cleanup", exact: true }).click();
    const confirm = page.getByRole("alertdialog");
    await confirm.getByRole("button", { name: "Cleanup", exact: true }).click();
    await expect(page.getByText(/Cleanup applied to e2e-002/)).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => existsSync(WORKTREE_DIR), { timeout: 20_000 }).toBe(false);
  });

  test("merge is disabled while the PR is not mergeable", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: /Harden rate limiter/ }).click();
    const drawer = page.getByRole("dialog");

    const merge = drawer.getByRole("button", { name: "Merge", exact: true });
    await expect(merge).toBeVisible();
    await expect(merge).toBeDisabled();
  });
});
