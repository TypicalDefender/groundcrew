/**
 * Shared first step for both frame parsers (client → server and server →
 * client): a frame is JSON, an object, and carries a `type` discriminant.
 */

export interface FramePayload {
  type: unknown;
}

export function parseFramePayload(raw: string): FramePayload | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed === "object" && parsed !== null && "type" in parsed) {
    return parsed;
  }
  return undefined;
}
