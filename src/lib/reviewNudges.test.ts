import type { ReviewComment } from "./pullRequests.ts";
import { formatReviewCommentsNudge, selectUndeliveredComments } from "./reviewNudges.ts";

function comment(id: string, overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id,
    threadId: `t-${id}`,
    author: "alice",
    body: `body of ${id}`,
    url: `https://github.com/acme/repo-a/pull/7#discussion_${id}`,
    path: "src/lib/board.ts",
    line: 12,
    ...overrides,
  };
}

describe(selectUndeliveredComments, () => {
  it("filters out already-delivered ids and tolerates an absent memo", () => {
    const all = [comment("c1"), comment("c2"), comment("c3")];

    expect(selectUndeliveredComments(all, ["c1", "c3"]).map((c) => c.id)).toStrictEqual(["c2"]);
    expect(selectUndeliveredComments(all)).toHaveLength(3);
    expect(selectUndeliveredComments([], ["c1"])).toStrictEqual([]);
  });
});

describe(formatReviewCommentsNudge, () => {
  it("lists each comment as file:line (author): body with a fix instruction", () => {
    const nudge = formatReviewCommentsNudge({
      prUrl: "https://github.com/acme/repo-a/pull/7",
      comments: [
        comment("c1", { body: "use a Map here" }),
        {
          id: "c2",
          threadId: "t-c2",
          author: "bob",
          body: "typo",
          url: "https://github.com/acme/repo-a/pull/7#discussion_c2",
          path: "README.md",
        },
        {
          id: "c3",
          threadId: "t-c3",
          author: "alice",
          body: "general note",
          url: "https://github.com/acme/repo-a/pull/7#discussion_c3",
        },
      ],
    });

    expect(nudge).toContain(
      "Your pull request (https://github.com/acme/repo-a/pull/7) has unresolved review comments:",
    );
    expect(nudge).toContain("- src/lib/board.ts:12 (alice):\n  use a Map here");
    expect(nudge).toContain("- README.md (bob):\n  typo");
    expect(nudge).toContain("- PR discussion (alice):\n  general note");
    expect(nudge).toContain("resolve the threads, and push an update to the same branch.");
  });

  it("trims whitespace and truncates very long comment bodies", () => {
    const nudge = formatReviewCommentsNudge({
      prUrl: "https://github.com/acme/repo-a/pull/7",
      comments: [comment("c1", { body: `  ${"x".repeat(700)}  ` })],
    });

    expect(nudge).toContain("x".repeat(600));
    expect(nudge).not.toContain("x".repeat(601));
    expect(nudge).toContain("… (truncated)");
  });
});
