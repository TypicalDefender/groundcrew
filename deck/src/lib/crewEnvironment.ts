/**
 * The deck server's working directory is the deck workspace, but crew
 * sources may resolve relative paths (a todo.txt, prompt files) against the
 * directory the operator launched `crew deck` from. That directory arrives
 * via GROUNDCREW_PROJECT_CWD; restore it once before the first config load.
 */

import { existsSync } from "node:fs";

let restored = false;

export function restoreOperatorDirectory(): void {
  if (restored) {
    return;
  }
  restored = true;
  // oxlint-disable-next-line node/no-process-env -- handoff channel from the crew CLI to the deck server
  const operatorDirectory = process.env.GROUNDCREW_PROJECT_CWD;
  if (
    operatorDirectory !== undefined &&
    operatorDirectory.length > 0 &&
    existsSync(operatorDirectory)
  ) {
    process.chdir(operatorDirectory);
  }
}
