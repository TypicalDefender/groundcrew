const config = {
  sources: [{ kind: "todo-txt", todoPath: "todo.txt" }],
  workspaceKind: "tmux",
  workspace: {
    projectDir: "./project",
    knownRepositories: ["repo-a"],
  },
  git: { branchPrefix: "e2e" },
  agents: {
    default: "claude",
    definitions: {
      // Harmless stand-ins: a real window that stays alive, no real agent.
      claude: { cmd: "sh -c 'echo agent ready; exec sleep 600'", color: "#C15F3C" },
      codex: { cmd: "sh -c 'echo agent ready; exec sleep 600'", color: "#3267E3" },
    },
  },
  local: { runner: "none" },
  deck: { port: 4411, pollIntervalMilliseconds: 1000 },
  logging: { file: "./state/groundcrew.log" },
};

export default config;
