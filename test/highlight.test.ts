import { describe, expect, it } from "vitest";
import { highlightLines, languageForPath, splitHighlighted } from "../src/core/diff/highlight";

describe("languageForPath", () => {
  it("maps extensions and special names", () => {
    expect(languageForPath("/src/App.tsx")).toBe("typescript");
    expect(languageForPath("/a/b/Program.CS")).toBe("csharp");
    expect(languageForPath("/Dockerfile")).toBe("dockerfile");
    expect(languageForPath("/x/app.csproj")).toBe("xml");
    expect(languageForPath("/LICENSE")).toBeUndefined();
    expect(languageForPath("/a.unknownext")).toBeUndefined();
  });
});

describe("splitHighlighted", () => {
  it("closes and reopens spans that cross a line break", () => {
    expect(splitHighlighted('<span class="c">a\nb</span>\nd')).toEqual(['<span class="c">a</span>', '<span class="c">b</span>', "d"]);
  });
  it("keeps nested spans balanced per line", () => {
    const lines = splitHighlighted('<span class="o">x<span class="i">y\nz</span>w</span>');
    expect(lines).toEqual(['<span class="o">x<span class="i">y</span></span>', '<span class="o"><span class="i">z</span>w</span>']);
  });
});

describe("highlightLines", () => {
  it("returns one entry per line with token spans and escaped content", () => {
    const lines = highlightLines("const a = '<b>';\r\n// note", "typescript")!;
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('class="hljs-keyword"');
    expect(lines[0]).toContain("&lt;b&gt;");
    expect(lines[0]).not.toContain("<b>");
    expect(lines[1]).toContain("hljs-comment");
  });
  it("keeps a multi-line comment highlighted on every line", () => {
    const lines = highlightLines("/* a\nb\nc */\nlet x;", "typescript")!;
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain("hljs-comment");
    expect(lines[2]).toContain("hljs-comment");
  });
  it("returns undefined for an unknown language or empty text", () => {
    expect(highlightLines("x", undefined)).toBeUndefined();
    expect(highlightLines("", "json")).toBeUndefined();
  });
});
