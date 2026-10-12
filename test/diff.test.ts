import { describe, expect, it } from "vitest";
import { anchorForRow, findInWindow } from "../src/core/diff/anchors";
import { buildDiffRows, expandGap } from "../src/core/diff/lineDiff";

describe("buildDiffRows", () => {
  it("numbers added, removed and context lines on both sides", () => {
    const { rows, added, removed } = buildDiffRows("a\nb\nc\n", "a\nB\nc\nd\n");
    expect(added).toBe(2);
    expect(removed).toBe(1);
    expect(rows.map((r) => [r.type, r.oldLine, r.newLine, r.text])).toEqual([
      ["context", 1, 1, "a"],
      ["delete", 2, undefined, "b"],
      ["add", undefined, 2, "B"],
      ["context", 3, 3, "c"],
      ["add", undefined, 4, "d"]
    ]);
  });

  it("handles brand new and fully deleted files", () => {
    expect(buildDiffRows("", "x\ny\n").added).toBe(2);
    expect(buildDiffRows("x\ny\n", "").removed).toBe(2);
    expect(buildDiffRows("", "").rows).toEqual([]);
  });

  it("collapses long unchanged runs into gap rows and can expand them", () => {
    const body = Array.from({ length: 30 }, (_, i) => `l${i}`);
    const oldText = body.join("\n") + "\n";
    const newText = ["first", ...body, "last"].join("\n") + "\n";
    const { rows } = buildDiffRows(oldText, newText, 3);
    const gap = rows.find((r) => r.type === "gap")!;
    expect(gap.hidden).toBe(24);
    const full = buildDiffRows(oldText, newText, -1).rows;
    expect(expandGap(gap, full)).toHaveLength(24);
  });

  it("treats CRLF input like LF", () => {
    expect(buildDiffRows("a\r\nb\r\n", "a\r\nb\r\n").added).toBe(0);
  });
});

describe("anchorForRow", () => {
  const { rows } = buildDiffRows("a\nold\nc\n", "a\nnew\nc\n", -1);

  it("anchors added and context lines on the right side line", () => {
    const add = rows.find((r) => r.type === "add")!;
    expect(anchorForRow(add, rows)).toEqual({ rightLine: 2 });
    const ctx = rows.find((r) => r.type === "context")!;
    expect(anchorForRow(ctx, rows)).toEqual({ rightLine: 1 });
  });

  it("anchors a deleted line on the native left side when the text matches", () => {
    const del = rows.find((r) => r.type === "delete")!;
    expect(anchorForRow(del, rows, ["a", "x", "old", "c"])).toEqual({ leftLine: 3 });
  });

  it("falls back to the next right line and quotes the removed text", () => {
    const del = rows.find((r) => r.type === "delete")!;
    const anchor = anchorForRow(del, rows, ["unrelated"]);
    expect(anchor.rightLine).toBe(2);
    expect(anchor.quote).toContain("old");
  });

  it("findInWindow prefers the closest match and respects the window", () => {
    const lines = ["x", "dup", "y", "z", "dup"];
    expect(findInWindow(lines, "dup", 4)).toBe(5);
    expect(findInWindow(lines, "dup", 2)).toBe(2);
    expect(findInWindow(lines, "missing", 1)).toBeUndefined();
  });
});
