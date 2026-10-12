import { describe, expect, it } from "vitest";
import { detectStacks, flattenForest, isStacked } from "../src/core/stack/detect";
import { PrInfo } from "../src/core/stack/types";

let day = 0;
function pr(id: number, over: Partial<PrInfo> = {}): PrInfo {
  return {
    id,
    repositoryId: "repo1",
    repositoryName: "Repo1",
    title: `PR ${id}`,
    isDraft: false,
    status: "active",
    sourceRef: `refs/heads/b${id}`,
    targetRef: "refs/heads/main",
    headSha: `h${id}`,
    creationDate: new Date(2026, 0, ++day),
    ...over
  };
}

/** Builds PRs whose head is the last commit listed, so fixtures stay self-consistent. */
function prsFrom(m: Record<number, string[]>): PrInfo[] {
  return Object.entries(m).map(([id, c]) => pr(Number(id), { headSha: c[c.length - 1] }));
}

const commits = (m: Record<number, string[]>) => new Map(Object.entries(m).map(([k, v]) => [Number(k), new Set(v)]));

describe("detectStacks", () => {
  it("treats unrelated PRs as separate roots", () => {
    const forest = detectStacks([pr(1), pr(2)], { commitsByPr: commits({ 1: ["a"], 2: ["b"] }) });
    expect(forest.rootIds).toEqual([1, 2]);
    expect(forest.nodes.get(1)!.health).toBe("root");
    expect(isStacked(forest.nodes.get(1)!)).toBe(false);
  });

  it("detects the classic case: both PRs target main, B contains A", () => {
    const a = pr(1, { headSha: "a1" });
    const b = pr(2, { headSha: "b1" });
    const forest = detectStacks([a, b], { commitsByPr: commits({ 1: ["a1"], 2: ["a1", "b1"] }) });
    const nb = forest.nodes.get(2)!;
    expect(nb.parentId).toBe(1);
    expect(nb.relation).toBe("contained");
    expect(nb.health).toBe("in-sync");
    expect(nb.depth).toBe(1);
    expect(forest.nodes.get(1)!.childIds).toEqual([2]);
    expect(forest.rootIds).toEqual([1]);
  });

  it("detects explicit stacks where B targets A's branch", () => {
    const a = pr(1, { sourceRef: "refs/heads/a", headSha: "a1" });
    const b = pr(2, { targetRef: "refs/heads/a", targetSha: "a1" });
    const forest = detectStacks([a, b], { commitsByPr: commits({ 1: ["a1"], 2: ["b1"] }) });
    expect(forest.nodes.get(2)!.relation).toBe("explicit");
    expect(forest.nodes.get(2)!.health).toBe("in-sync");
  });

  it("flags an explicit child as parent-ahead when the parent moved on", () => {
    const a = pr(1, { sourceRef: "refs/heads/a", headSha: "a2" });
    const b = pr(2, { targetRef: "refs/heads/a", targetSha: "a1" });
    const forest = detectStacks([a, b], { commitsByPr: commits({ 1: ["a1", "a2"], 2: ["b1"] }) });
    expect(forest.nodes.get(2)!.health).toBe("parent-ahead");
  });

  it("builds a chain A <- B <- C using transitive reduction", () => {
    const m = { 1: ["a"], 2: ["a", "b"], 3: ["a", "b", "c"] };
    const forest = detectStacks(prsFrom(m), { commitsByPr: commits(m) });
    expect(forest.nodes.get(3)!.parentId).toBe(2);
    expect(forest.nodes.get(2)!.parentId).toBe(1);
    expect(flattenForest(forest).map((n) => [n.pr.id, n.depth])).toEqual([
      [1, 0],
      [2, 1],
      [3, 2]
    ]);
    expect(forest.nodes.get(3)!.stackRootId).toBe(1);
  });

  it("builds a branching stack (two children on one parent)", () => {
    const m = { 1: ["a"], 2: ["a", "b"], 3: ["a", "c"] };
    const forest = detectStacks(prsFrom(m), { commitsByPr: commits(m) });
    expect(forest.nodes.get(1)!.childIds).toEqual([2, 3]);
  });

  it("reports parent-ahead when the parent has commits the child lacks", () => {
    const a = pr(1, { headSha: "a2" });
    const b = pr(2, { headSha: "b1" });
    const forest = detectStacks([a, b], { commitsByPr: commits({ 1: ["a1", "a2"], 2: ["a1", "b1"] }) });
    expect(forest.nodes.get(2)!.parentId).toBe(1);
    expect(forest.nodes.get(2)!.health).toBe("parent-ahead");
  });

  it("does not stack PRs from different repositories or targets", () => {
    const other = pr(2, { repositoryId: "repo2" });
    const release = pr(3, { targetRef: "refs/heads/release" });
    const forest = detectStacks([pr(1), other, release], {
      commitsByPr: commits({ 1: ["a"], 2: ["a", "b"], 3: ["a", "c"] })
    });
    expect(forest.rootIds).toEqual([1, 2, 3]);
  });

  it("marks children of a completed parent as parent-merged (squash merge case)", () => {
    const a = pr(1, { status: "completed", headSha: "a1" });
    const b = pr(2);
    const forest = detectStacks([a, b], { commitsByPr: commits({ 1: ["a1"], 2: ["a1", "b1"] }) });
    expect(forest.nodes.get(2)!.health).toBe("parent-merged");
  });

  it("honours manual parents and ignores cycles", () => {
    const forest = detectStacks([pr(1), pr(2)], {
      commitsByPr: commits({ 1: ["x"], 2: ["y"] }),
      manualParents: new Map([
        [2, 1],
        [1, 2]
      ])
    });
    // One of the two edges must be dropped.
    const parents = [forest.nodes.get(1)!.parentId, forest.nodes.get(2)!.parentId].filter((p) => p !== undefined);
    expect(parents).toHaveLength(1);
    expect(forest.rootIds).toHaveLength(1);
  });

  it("manual parent overrides inferred relations", () => {
    const forest = detectStacks([pr(1), pr(2), pr(3)], {
      commitsByPr: commits({ 1: ["a"], 2: ["a", "b"], 3: ["a", "b", "c"] }),
      manualParents: new Map([[3, 1]])
    });
    expect(forest.nodes.get(3)!.parentId).toBe(1);
    expect(forest.nodes.get(3)!.relation).toBe("manual");
  });

  it("propagates merge conflicts and handles identical heads deterministically", () => {
    const a = pr(1, { headSha: "same" });
    const b = pr(2, { headSha: "same", mergeStatus: "conflicts" });
    const forest = detectStacks([a, b], { commitsByPr: commits({ 1: ["same"], 2: ["same"] }) });
    expect(forest.nodes.get(2)!.parentId).toBe(1);
    expect(forest.nodes.get(2)!.hasConflicts).toBe(true);
    expect(forest.nodes.get(1)!.parentId).toBeUndefined();
  });

  it("flattenForest supports filtering", () => {
    const forest = detectStacks([pr(1), pr(2), pr(3)], { commitsByPr: commits({ 1: ["a"], 2: ["a", "b"], 3: ["z"] }) });
    expect(flattenForest(forest, isStacked).map((n) => n.pr.id)).toEqual([1, 2]);
  });
});
