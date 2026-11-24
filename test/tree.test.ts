import { describe, expect, it } from "vitest";
import { buildTree, changeLetter, flattenTree, matchesFileFilter } from "../src/ui/pr/tree";

describe("file tree", () => {
  const files = [{ path: "/docs/research/b.md" }, { path: "/README.md" }, { path: "/docs/research/a.md" }, { path: "/docs/x.md" }];

  it("nests folders, sorting folders before files", () => {
    const tree = buildTree(files);
    expect(tree.map((n) => n.name)).toEqual(["docs", "README.md"]);
    const docs = tree[0];
    expect(docs.children.map((n) => n.name)).toEqual(["research", "x.md"]);
    expect(docs.children[0].children.map((n) => n.name)).toEqual(["a.md", "b.md"]);
  });

  it("flattens honouring collapsed folders", () => {
    const tree = buildTree(files);
    expect(flattenTree(tree, new Set()).map((r) => [r.node.name, r.depth])).toEqual([
      ["docs", 0],
      ["research", 1],
      ["a.md", 2],
      ["b.md", 2],
      ["x.md", 1],
      ["README.md", 0]
    ]);
    expect(flattenTree(tree, new Set(["/docs/research"])).map((r) => r.node.name)).toEqual(["docs", "research", "x.md", "README.md"]);
  });

  it("maps change types to letters", () => {
    expect(changeLetter(1)).toBe("A");
    expect(changeLetter(2)).toBe("M");
    expect(changeLetter(16)).toBe("D");
    expect(changeLetter(8 | 2)).toBe("R");
  });
});

describe("file filter", () => {
  it("matches plain terms case-insensitively, all of them", () => {
    expect(matchesFileFilter("/src/App.tsx", "app")).toBe(true);
    expect(matchesFileFilter("/src/App.tsx", "src app")).toBe(true);
    expect(matchesFileFilter("/src/App.tsx", "src lib")).toBe(false);
    expect(matchesFileFilter("/src/App.tsx", "")).toBe(true);
  });

  it("hides files matching a !term", () => {
    expect(matchesFileFilter("/src/App.test.ts", "!test")).toBe(false);
    expect(matchesFileFilter("/src/App.ts", "!test")).toBe(true);
    expect(matchesFileFilter("/test/App.ts", "!TEST")).toBe(false);
  });

  it("combines include and exclude terms and ignores a lone !", () => {
    expect(matchesFileFilter("/src/App.ts", "src !test")).toBe(true);
    expect(matchesFileFilter("/src/App.test.ts", "src !test")).toBe(false);
    expect(matchesFileFilter("/lib/App.ts", "src !test")).toBe(false);
    expect(matchesFileFilter("/src/App.ts", "!")).toBe(true);
  });
});
