import { execSync } from "node:child_process";

import { expect, test } from "@playwright/test";

const TASK = "e2e-001";
const WINDOW = `groundcrew:${TASK}`;

function hasTmux(): boolean {
  try {
    execSync("tmux -V", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function shell(command: string): void {
  execSync(command, { stdio: "ignore" });
}

/** A real interactive shell in the task's window, so keystrokes echo back. */
function ensureShellWindow(): void {
  try {
    shell(`tmux kill-window -t ${WINDOW}`);
  } catch {
    // No leftover window — fine.
  }
  try {
    shell(`tmux new-window -d -t groundcrew -n ${TASK} "/bin/sh -i"`);
  } catch {
    shell(`tmux new-session -d -s groundcrew -n ${TASK} -x 120 -y 32 "/bin/sh -i"`);
  }
}

function windowWidth(): number {
  try {
    return Number(
      execSync(`tmux display -p -t ${WINDOW} "#{window_width}"`, { encoding: "utf8" }).trim(),
    );
  } catch {
    return 0;
  }
}

test.describe.serial("terminal pane", () => {
  test.skip(!hasTmux(), "tmux is required for the live terminal");

  test.beforeAll(() => {
    ensureShellWindow();
  });

  test.afterAll(() => {
    try {
      shell(`tmux kill-window -t ${WINDOW}`);
    } catch {
      // Already gone.
    }
  });

  test("keystrokes round-trip through the real pane and echo back", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/");

    await page.getByRole("button", { name: /Fix login retry race/ }).click();
    const drawer = page.getByRole("dialog");
    const terminal = drawer.getByLabel(`Terminal for ${TASK}`);
    await expect(terminal).toBeVisible();
    await expect(drawer.getByLabel("terminal status")).toHaveText("live", { timeout: 15_000 });

    // Type into xterm; the shell behind the real pane echoes and executes.
    await terminal.click();
    await page.keyboard.type('echo "e2e-rt-$((40 + 2))"', { delay: 20 });
    await page.keyboard.press("Enter");
    await expect(terminal).toContainText("e2e-rt-42", { timeout: 15_000 });
  });

  test("a second viewer is read-only while the first holds the keyboard", async ({
    browser,
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Fix login retry race/ }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByLabel("terminal status")).toHaveText("live", { timeout: 15_000 });

    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await secondPage.goto("/");
    await secondPage.getByRole("button", { name: /Fix login retry race/ }).click();
    const secondDrawer = secondPage.getByRole("dialog");
    await expect(secondDrawer.getByLabel("terminal status")).toHaveText("read-only", {
      timeout: 15_000,
    });
    await secondContext.close();
  });

  test("expanding to full screen resizes the real tmux window", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Fix login retry race/ }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByLabel("terminal status")).toHaveText("live", { timeout: 15_000 });

    // The drawer is narrow; fit() shrinks the attached window well below 100.
    await expect.poll(() => windowWidth(), { timeout: 10_000 }).toBeLessThan(100);

    await drawer.getByRole("button", { name: "Expand", exact: true }).click();
    await expect.poll(() => windowWidth(), { timeout: 10_000 }).toBeGreaterThan(100);

    await drawer.getByRole("button", { name: "Collapse", exact: true }).click();
    await expect(drawer.getByRole("button", { name: "Expand", exact: true })).toBeVisible();
  });
});
