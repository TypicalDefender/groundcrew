/** Next instrumentation hook: boots the terminal bridge with the server. */
export async function register(): Promise<void> {
  // oxlint-disable-next-line node/no-process-env -- Next's documented runtime discriminator
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startTerminalServer } = await import("@/lib/terminalServer");
    await startTerminalServer();
    // The deck observes pulse/PR transitions; give those observations a
    // notification sink too.
    const { restoreOperatorDirectory } = await import("@/lib/crewEnvironment");
    restoreOperatorDirectory();
    const { initializeCrewEvents, loadConfig } = await import("@clipboard-health/groundcrew");
    await initializeCrewEvents(await loadConfig());
  }
}
