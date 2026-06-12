/**
 * Shared client-side POST for deck actions. Resolves to `undefined` on
 * success and a human-readable error message on failure, so action buttons
 * share one error-extraction path.
 */
export async function postAction(url: string, body?: unknown): Promise<string | undefined> {
  try {
    const response = await fetch(url, {
      method: "POST",
      ...(body === undefined
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    if (response.ok) {
      return undefined;
    }
    const parsed: unknown = await response.json();
    return typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof parsed.error === "string"
      ? parsed.error
      : `request failed (${response.status})`;
  } catch {
    return "network error";
  }
}
