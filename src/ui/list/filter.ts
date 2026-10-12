import { flattenForest, isStacked } from "../../core/stack/detect";
import { StackForest, StackNode } from "../../core/stack/types";

export type ListTab = "active" | "mine" | "review" | "drafts" | "completed";

export interface ReviewerLite {
  id?: string;
  vote: number;
}

export interface ListFilter {
  tab: ListTab;
  search: string;
  repositoryIds: string[];
  stackedOnly: boolean;
  userId: string;
}

export type ReviewersOf = (prId: number) => ReviewerLite[];

function matchesTab(n: StackNode, f: ListFilter, reviewersOf: ReviewersOf): boolean {
  const pr = n.pr;
  switch (f.tab) {
    case "active":
      return pr.status === "active" && !pr.isDraft;
    case "drafts":
      return pr.status === "active" && pr.isDraft;
    case "completed":
      return pr.status === "completed";
    case "mine":
      return pr.status === "active" && (pr.authorId === f.userId || reviewersOf(pr.id).some((r) => r.id === f.userId));
    case "review":
      return pr.status === "active" && !pr.isDraft && reviewersOf(pr.id).some((r) => r.id === f.userId && r.vote === 0);
  }
}

function matchesText(n: StackNode, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const pr = n.pr;
  return [pr.title, pr.authorName, pr.sourceRef, pr.targetRef, pr.repositoryName, String(pr.id)]
    .filter(Boolean)
    .some((s) => s!.toLowerCase().includes(q));
}

/**
 * Applies the list filters to a stack forest and returns the rows to render in
 * display order. Ancestors of a matching PR are kept (dimmed by the caller via
 * `matched === false`) so each row stays visible inside its hierarchy.
 */
export function filterForest(
  forest: StackForest,
  f: ListFilter,
  reviewersOf: ReviewersOf
): { node: StackNode; matched: boolean }[] {
  const matched = new Set<number>();
  for (const n of forest.nodes.values()) {
    if (f.repositoryIds.length && !f.repositoryIds.includes(n.pr.repositoryId)) continue;
    if (f.stackedOnly && !isStacked(n)) continue;
    if (matchesTab(n, f, reviewersOf) && matchesText(n, f.search)) matched.add(n.pr.id);
  }

  const keep = new Set<number>(matched);
  for (const id of matched) {
    let p = forest.nodes.get(id)!.parentId;
    while (p !== undefined && !keep.has(p)) {
      keep.add(p);
      p = forest.nodes.get(p)!.parentId;
    }
  }

  return flattenForest(forest, (n) => keep.has(n.pr.id)).map((node) => ({ node, matched: matched.has(node.pr.id) }));
}

export function tabCounts(forest: StackForest, base: Omit<ListFilter, "tab">, reviewersOf: ReviewersOf): Record<ListTab, number> {
  const tabs: ListTab[] = ["active", "mine", "review", "drafts", "completed"];
  const out = {} as Record<ListTab, number>;
  for (const tab of tabs) {
    out[tab] = filterForest(forest, { ...base, tab }, reviewersOf).filter((r) => r.matched).length;
  }
  return out;
}

/** Number of distinct stacks (trees with at least two PRs). */
export function stackCount(forest: StackForest): number {
  return forest.rootIds.filter((id) => forest.nodes.get(id)!.childIds.length > 0).length;
}
