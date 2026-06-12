/** Next instrumentation hook: boots the terminal bridge with the server. */
export async function register(): Promise<void> {
  // oxlint-disable-next-line node/no-process-env -- Next's documented runtime discriminator
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startTerminalServer } = await import("@/lib/terminalServer");
    await startTerminalServer();
  }
}
