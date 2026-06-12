const config = {
  sources: [{ kind: "todo-txt", todoPath: "todo.txt" }],
  workspaceKind: "tmux",
  workspace: {
    projectDir: "./project",
    knownRepositories: ["repo-a"],
  },
  agents: { default: "claude", definitions: { claude: {}, codex: {} } },
  deck: { port: 4411, pollIntervalMilliseconds: 1000 },
  logging: { file: "./state/groundcrew.log" },
};

export default config;
