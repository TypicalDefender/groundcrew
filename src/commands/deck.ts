/**
 * `crew deck` — build and serve the deck, the crew's web dashboard. The
 * deck is a Next.js workspace that ships with the repo; this command wraps
 * its build/start lifecycle so operators never cd into `deck/` themselves.
 *
 * Pure planning (`deckCommandPlan`) is separated from process I/O so tests
 * assert the exact commands without spawning anything.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { loadConfigWithSource, type ResolvedConfig } from "../lib/config.ts";

export interface DeckOptions {
  /** Overrides `deck.port` from config. */
  port?: number;
  /** Run the dev server (hot reload) instead of build + start. */
  dev?: boolean;
  /** Skip the production build and serve the existing one. */
  skipBuild?: boolean;
}

export interface DeckStep {
  command: string;
  args: readonly string[];
  cwd: string;
  /** Extra environment for the child; the deck server needs the config path. */
  env?: Readonly<Record<string, string>>;
}

export interface DeckCommandPlanInput {
  config: ResolvedConfig;
  options: DeckOptions;
  deckDir: string;
  /** Resolved crew config file; exported so the deck's API routes load the same config. */
  configPath?: string;
}

/** The processes `crew deck` runs, in order. The last one serves until killed. */
export function deckCommandPlan(input: DeckCommandPlanInput): DeckStep[] {
  const { config, options, deckDir, configPath } = input;
  const port = String(options.port ?? config.deck.port);
  // The server runs with cwd=deck/, but sources may resolve relative paths
  // (e.g. a todo.txt) against the operator's directory — export both.
  const env =
    configPath === undefined
      ? {}
      : { env: { GROUNDCREW_CONFIG: configPath, GROUNDCREW_PROJECT_CWD: process.cwd() } };
  if (options.dev === true) {
    return [{ command: "npx", args: ["next", "dev", "--port", port], cwd: deckDir, ...env }];
  }
  const steps: DeckStep[] = [];
  if (options.skipBuild !== true) {
    steps.push({ command: "npx", args: ["next", "build"], cwd: deckDir, ...env });
  }
  steps.push({ command: "npx", args: ["next", "start", "--port", port], cwd: deckDir, ...env });
  return steps;
}

export function parseDeckArguments(argv: readonly string[]): DeckOptions {
  const options: DeckOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dev") {
      options.dev = true;
      continue;
    }
    if (argument === "--no-build") {
      options.skipBuild = true;
      continue;
    }
    if (argument === "--port") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 1 || value > 65_535) {
        throw new Error("Usage: crew deck [--port <1-65535>] [--dev] [--no-build]");
      }
      options.port = value;
      index += 1;
      continue;
    }
    throw new Error("Usage: crew deck [--port <1-65535>] [--dev] [--no-build]");
  }
  return options;
}

/** Process runner seam; production uses an inherited-stdio spawn. @public */
export type RunDeckStep = (step: DeckStep) => Promise<number>;

export interface DeckRunInput {
  config: ResolvedConfig;
  options: DeckOptions;
  deckDir?: string;
  configPath?: string;
  runStep?: RunDeckStep;
}

export async function deck(input: DeckRunInput): Promise<void> {
  const { config, options } = input;
  const deckDir = input.deckDir ?? defaultDeckDirectory();
  if (!existsSync(deckDir)) {
    throw new Error(
      `Deck workspace not found at ${deckDir}. The deck ships with the groundcrew repo; run from a checkout that includes it.`,
    );
  }
  /* v8 ignore next @preserve -- the default runner spawns real servers; tests always inject */
  const runStep = input.runStep ?? runDeckStepInherited;
  const { configPath } = input;
  for (const step of deckCommandPlan({
    config,
    options,
    deckDir,
    ...(configPath === undefined ? {} : { configPath }),
  })) {
    // oxlint-disable-next-line no-await-in-loop -- build must finish before the server starts.
    const exitCode = await runStep(step);
    if (exitCode !== 0) {
      throw new Error(`${step.command} ${step.args.join(" ")} exited with code ${exitCode}`);
    }
  }
}

export async function deckCli(argv: string[], runDeck: typeof deck = deck): Promise<void> {
  const options = parseDeckArguments(argv);
  const loaded = await loadConfigWithSource();
  await runDeck({
    config: loaded.config,
    options,
    configPath: loaded.source.filepath,
  });
}

/** `<package root>/deck`, resolved relative to this module's compiled home. */
function defaultDeckDirectory(): string {
  return path.resolve(import.meta.dirname, "..", "..", "deck");
}

/** Default runner: stream the step's output straight to the operator's terminal. */
export async function runDeckStepInherited(step: DeckStep): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const child = spawn(step.command, [...step.args], {
      cwd: step.cwd,
      stdio: "inherit",
      // oxlint-disable-next-line node/no-process-env -- the child must inherit the full environment plus the config path
      env: { ...process.env, ...step.env },
    });
    child.on("error", reject);
    child.on("close", (code) => {
      /* v8 ignore next @preserve -- code is null only when the child died from a signal */
      resolve(code ?? 1);
    });
  });
}
