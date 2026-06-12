/**
 * Review-comment nudges for autopilot: fold the unresolved review threads
 * a human left on the task's PR into one readable nudge, and pick out
 * which comments are new since the last delivery (delivered ids live on
 * the run state, so each comment is sent exactly once).
 */

import type { ReviewComment } from "./pullRequests.ts";

const MAX_BODY_CHARS = 600;

/** Comments not yet delivered to the agent. */
export function selectUndeliveredComments(
  comments: readonly ReviewComment[],
  deliveredIds?: readonly string[],
): ReviewComment[] {
  const delivered = new Set(deliveredIds);
  return comments.filter((comment) => !delivered.has(comment.id));
}

function location(comment: ReviewComment): string {
  if (comment.path === undefined) {
    return "PR discussion";
  }
  return comment.line === undefined ? comment.path : `${comment.path}:${comment.line}`;
}

function trimmedBody(comment: ReviewComment): string {
  const collapsed = comment.body.trim();
  if (collapsed.length <= MAX_BODY_CHARS) {
    return collapsed;
  }
  return `${collapsed.slice(0, MAX_BODY_CHARS)}… (truncated)`;
}

export interface FormatReviewCommentsNudgeInput {
  prUrl: string;
  comments: readonly ReviewComment[];
}

/** One nudge body listing every comment as `file:line (author): body`. */
export function formatReviewCommentsNudge(input: FormatReviewCommentsNudgeInput): string {
  const items = input.comments.map(
    (comment) => `- ${location(comment)} (${comment.author}):\n  ${trimmedBody(comment)}`,
  );
  return [
    `Your pull request (${input.prUrl}) has unresolved review comments:`,
    "",
    ...items,
    "",
    "Please address each comment, resolve the threads, and push an update to the same branch.",
  ].join("\n");
}
