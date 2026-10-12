import { describe, expect, it } from "vitest";
import { buildThreadPayload, fallbackComment } from "../src/core/diff/threadPayload";

describe("buildThreadPayload", () => {
  it("anchors right-side comments on the latest iteration with a change tracking id", () => {
    const p = buildThreadPayload({ filePath: "/a.ts", anchor: { rightLine: 12 }, text: "hi", iterationId: 4, changeTrackingId: 9, lineLength: 20 })!;
    expect(p.threadContext).toEqual({
      filePath: "/a.ts",
      rightFileStart: { line: 12, offset: 1 },
      rightFileEnd: { line: 12, offset: 21 }
    });
    expect(p.pullRequestThreadContext).toEqual({
      changeTrackingId: 9,
      iterationContext: { firstComparingIteration: 4, secondComparingIteration: 4 }
    });
    expect(p.comments[0]).toEqual({ parentCommentId: 0, content: "hi", commentType: 1 });
    expect(p.status).toBe(1);
  });

  it("uses the left side when the anchor is a native left line", () => {
    const p = buildThreadPayload({ filePath: "/a.ts", anchor: { leftLine: 3 }, text: "x", iterationId: 1, changeTrackingId: 2 })!;
    expect(p.threadContext!.leftFileStart).toEqual({ line: 3, offset: 1 });
    expect(p.threadContext!.rightFileStart).toBeUndefined();
  });

  it("prepends the quote for approximated anchors", () => {
    const p = buildThreadPayload({ filePath: "/a.ts", anchor: { rightLine: 2, quote: "> gone\n\n" }, text: "why?", iterationId: 1, changeTrackingId: 2 })!;
    expect(p.comments[0].content).toBe("> gone\n\nwhy?");
  });

  it("returns undefined without a change tracking id or a line", () => {
    expect(buildThreadPayload({ filePath: "/a", anchor: { rightLine: 1 }, text: "x", iterationId: 1 })).toBeUndefined();
    expect(buildThreadPayload({ filePath: "/a", anchor: {}, text: "x", iterationId: 1, changeTrackingId: 1 })).toBeUndefined();
  });

  it("builds a PR-level fallback that names the location", () => {
    expect(fallbackComment("/a.ts", { rightLine: 7 }, "note")).toBe("**/a.ts:7**\n\nnote");
    expect(fallbackComment("/a.ts", {}, "note")).toBe("**/a.ts**\n\nnote");
  });
});
