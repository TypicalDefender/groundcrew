# Deck

The deck is the crew's web dashboard: a live board of every task the crew
knows about, joined from the task source, run states, worktrees, and
workspace liveness — the same fleet snapshot the CLI uses, streamed to the
browser.

## Start it

```bash
crew deck                 # build once, then serve on deck.port (default 4400)
crew deck --port 5000     # one-off port override
crew deck --no-build      # serve the existing build (faster restarts)
crew deck --dev           # hot-reloading dev server
```

Run it from your project directory (wherever you run `crew`): the deck
inherits the same resolved crew config and resolves relative source paths —
like a `todo.txt` — exactly as the CLI does. The server runs until
interrupted.

## What you see

- **Needs you** — a rail above the board lifting tasks that want a human:
  the agent is waiting for input or blocked, or the pull request has
  failing CI or requested changes.
- **Columns** — `Todo`, `In Progress`, `In Review`, `Done`, bucketed from
  each task's canonical source status. Tasks the source can't classify sit
  in `In Progress` while something is running and `Todo` otherwise.
- **Cards** — task id, title, branch, the agent badge in the agent's
  configured `color`, a pulse dot (the `active` dot breathes; animation is
  disabled under `prefers-reduced-motion`), CI and review chips, and the PR
  number.
- **Drawer** — click a card for the full picture: pull-request facts, run
  state history (started, updated, resumes, pulse transitions), workspace
  session/branch/worktree, and source links. `Esc` closes it.

The board updates live over a server-sent-events stream. If the stream
drops, a banner appears and the deck reconnects by itself; if the task
source is unreachable, the board says so and keeps showing local state.

## Controls

- **Live terminal**: each live task's drawer embeds its real workspace pane (tmux backend); the first viewer holds the keyboard, later viewers watch read-only, and the pane expands to full screen. Other backends fall back to periodic pane snapshots.
- **Pause / Wake**: a global control mirroring `crew pause` / `crew wake`, with an amber banner while paused.
- **Snooze**: per-task hold with duration choices in the drawer.
- **Autopilot**: a per-task panel (on/off switch, CI-nudge budget, recent actions) and a global activity feed on the board.

## Configuration

```ts
export default {
  deck: {
    // Port the deck server listens on.
    port: 4400,
    // How often the deck refreshes the fleet snapshot (milliseconds).
    pollIntervalMilliseconds: 5000,
  },
};
```

## API

The deck exposes the fleet read model over HTTP for tooling:

- `GET /api/fleet` — the current fleet snapshot as JSON.
- `GET /api/fleet/stream` — server-sent events; one snapshot immediately,
  then one per poll interval. Collection failures arrive as `feed-error`
  events.

## Portfolio (`crew deck --all`)

Every `crew run` / `crew deck` registers its config in `${XDG_STATE_HOME:-~/.local/state}/groundcrew/configs.json`. The `/portfolio` page (and `crew deck --all`, which prints its URL) aggregates a fleet snapshot per registered config; a config that fails to load shows its error without hiding the others.

Caveat: configs are loaded inside the deck server process, so **relative paths in a registered config (e.g. a `todo-txt` source's `todoPath`) resolve against the deck server's working directory**, not the config's directory. Use absolute paths in configs you want aggregated from elsewhere.
