import { describe, expect, it } from "vitest";
import { detectStacks } from "../src/core/stack/detect";
import { PrInfo } from "../src/core/stack/types";
import { filterForest, stackCount, tabCounts } from "../src/ui/list/filter";

function pr(id: number, over: Partial<PrInfo> = {}): PrInfo {
  return {
    id,
    repositoryId: "r1",
    repositoryName: "Repo1",
    title: `PR ${id}`,
    isDraft: false,
    status: "active",
    sourceRef: `refs/heads/b${id}`,
    targetRef: "refs/heads/main",
    headSha: `c${id}`,
    creationDate: new Date(2026, 0, id),
    authorId: "u1",
    authorName: "Ann",
    ...over
  };
}

// 1 <- 2 <- 3 in repo r1, 4 standalone in repo r2, 5 draft by someone else
const prs = [
  pr(1),
  pr(2),
  pr(3),
  pr(4, { repositoryId: "r2", repositoryName: "Repo2", authorId: "u2" }),
  pr(5, { isDraft: true, repositoryId: "r2", authorId: "u2", targetRef: "refs/heads/dev" })
];
const forest = detectStacks(prs, {
  commitsByPr: new Map([
    [1, new Set(["c1"])],
    [2, new Set(["c1", "c2"])],
    [3, new Set(["c1", "c2", "c3"])]
  ])
});
const base = { search: "", repositoryIds: [] as string[], stackedOnly: false, userId: "u1" };
const reviewers = (id: number) => (id === 4 ? [{ id: "u1", vote: 0 }] : id === 3 ? [{ id: "u2", vote: 10 }] : []);

describe("filterForest", () => {
  it("lists every active non-draft PR in hierarchy order across repositories", () => {
    const rows = filterForest(forest, { ...base, tab: "active" }, reviewers);
    expect(rows.map((r) => [r.node.pr.id, r.node.depth])).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 0]
    ]);
  });

  it("keeps ancestors of a matching PR so the hierarchy stays intact", () => {
    const rows = filterForest(forest, { ...base, tab: "active", search: "PR 3" }, reviewers);
    expect(rows.map((r) => [r.node.pr.id, r.matched])).toEqual([
      [1, false],
      [2, false],
      [3, true]
    ]);
  });

  it("filters by repository and stacked-only", () => {
    expect(filterForest(forest, { ...base, tab: "active", repositoryIds: ["r2"] }, reviewers).map((r) => r.node.pr.id)).toEqual([4]);
    expect(filterForest(forest, { ...base, tab: "active", stackedOnly: true }, reviewers).map((r) => r.node.pr.id)).toEqual([1, 2, 3]);
  });

  it("supports mine / needs-review / drafts tabs", () => {
    expect(filterForest(forest, { ...base, tab: "mine" }, reviewers).filter((r) => r.matched).map((r) => r.node.pr.id)).toEqual([1, 2, 3, 4]);
    expect(filterForest(forest, { ...base, tab: "review" }, reviewers).filter((r) => r.matched).map((r) => r.node.pr.id)).toEqual([4]);
    expect(filterForest(forest, { ...base, tab: "drafts" }, reviewers).map((r) => r.node.pr.id)).toEqual([5]);
  });

  it("counts tabs and stacks", () => {
    const c = tabCounts(forest, base, reviewers);
    expect(c).toMatchObject({ active: 4, review: 1, drafts: 1, completed: 0 });
    expect(stackCount(forest)).toBe(1);
  });
});
