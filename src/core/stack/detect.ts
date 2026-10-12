import { DetectOptions, PrInfo, Relation, StackForest, StackHealth, StackNode } from "./types";

interface Candidate {
  parent: PrInfo;
  relation: Relation;
  inSync: boolean;
}

/**
 * Builds the stack forest for a set of pull requests.
 *
 * Relationship rules, highest priority first:
 *  1. manual    - the user pinned a parent explicitly.
 *  2. explicit  - same repository and `child.targetRef === parent.sourceRef`.
 *  3. contained - same repository and target, and the parent's commits are
 *     (at least partly) part of the child's commit list. This is the classic
 *     "both PRs target main" stack.
 *
 * When several candidates qualify the closest one (the one with the most
 * commits, i.e. the deepest in the chain) wins, which gives a transitive
 * reduction: `A <- A2 <- B` yields `A <- A2 <- B`, not `A <- B`.
 */
export function detectStacks(prs: PrInfo[], options: DetectOptions): StackForest {
  const byId = new Map<number, PrInfo>(prs.map((p) => [p.id, p]));
  const commits = options.commitsByPr;
  const manual = options.manualParents ?? new Map<number, number>();

  const chosen = new Map<number, Candidate>();
  for (const child of prs) {
    const candidate = pickParent(child, prs, byId, commits, manual);
    if (candidate) chosen.set(child.id, candidate);
  }
  breakCycles(chosen);

  const nodes = new Map<number, StackNode>();
  for (const pr of prs) {
    nodes.set(pr.id, {
      pr,
      parentId: chosen.get(pr.id)?.parent.id,
      childIds: [],
      relation: chosen.get(pr.id)?.relation ?? "root",
      health: "root",
      hasConflicts: pr.mergeStatus === "conflicts",
      depth: 0,
      stackRootId: pr.id
    });
  }
  for (const node of nodes.values()) {
    if (node.parentId !== undefined) nodes.get(node.parentId)!.childIds.push(node.pr.id);
  }
  for (const node of nodes.values()) node.childIds.sort((a, b) => a - b);

  const rootIds = [...nodes.values()]
    .filter((n) => n.parentId === undefined)
    .map((n) => n.pr.id)
    .sort((a, b) => a - b);

  const assign = (id: number, depth: number, rootId: number) => {
    const node = nodes.get(id)!;
    node.depth = depth;
    node.stackRootId = rootId;
    const cand = chosen.get(id);
    node.health = cand ? healthOf(cand) : "root";
    for (const c of node.childIds) assign(c, depth + 1, rootId);
  };
  for (const r of rootIds) assign(r, 0, r);

  return { nodes, rootIds };
}

function pickParent(
  child: PrInfo,
  all: PrInfo[],
  byId: Map<number, PrInfo>,
  commits: Map<number, Set<string>>,
  manual: Map<number, number>
): Candidate | undefined {
  const manualId = manual.get(child.id);
  if (manualId !== undefined && manualId !== child.id && byId.has(manualId)) {
    const parent = byId.get(manualId)!;
    return { parent, relation: "manual", inSync: isInSync(parent, child, commits) };
  }

  const candidates: Candidate[] = [];
  for (const parent of all) {
    if (parent.id === child.id || parent.repositoryId !== child.repositoryId) continue;

    if (child.targetRef === parent.sourceRef && parent.targetRef !== parent.sourceRef) {
      const inSync = parent.headSha === child.targetSha || isInSync(parent, child, commits);
      candidates.push({ parent, relation: "explicit", inSync });
      continue;
    }

    if (child.targetRef !== parent.targetRef) continue;
    const rel = containment(parent, child, commits);
    if (rel) candidates.push({ parent, relation: "contained", inSync: rel === "in-sync" });
  }
  if (candidates.length === 0) return undefined;

  // Explicit relations beat inferred ones, then exact containment beats the
  // weaker "parent moved ahead" overlap (which also matches sibling PRs); within
  // a tier the deepest parent wins.
  const rank = (c: Candidate) => (c.relation === "explicit" ? 2 : 0) + (c.inSync ? 1 : 0);
  const size = (c: Candidate) => commits.get(c.parent.id)?.size ?? 0;
  candidates.sort((a, b) => rank(b) - rank(a) || size(b) - size(a) || b.parent.id - a.parent.id);
  return candidates[0];
}

function isInSync(parent: PrInfo, child: PrInfo, commits: Map<number, Set<string>>): boolean {
  return commits.get(child.id)?.has(parent.headSha) ?? false;
}

/**
 * Decides whether `parent` is contained in `child` (same target branch).
 * Returns "in-sync" when the child holds the parent's tip, "ahead" when the
 * parent moved on after the child branched off, otherwise undefined.
 */
function containment(
  parent: PrInfo,
  child: PrInfo,
  commits: Map<number, Set<string>>
): "in-sync" | "ahead" | undefined {
  const pc = commits.get(parent.id);
  const cc = commits.get(child.id);
  if (!pc || !cc || pc.size === 0 || cc.size === 0) return undefined;
  if (parent.headSha === child.headSha) {
    // Identical heads: treat the older PR as the parent so we never form a cycle.
    return parent.id < child.id ? "in-sync" : undefined;
  }

  if (cc.has(parent.headSha)) return pc.size < cc.size ? "in-sync" : undefined;
  if (pc.has(child.headSha)) return undefined; // child is contained in parent, not the other way round

  let shared = 0;
  for (const sha of pc) if (cc.has(sha)) shared++;
  if (shared === 0) return undefined;
  // Partial overlap and neither tip is in the other: the later PR is the child.
  const parentIsOlder =
    parent.creationDate.getTime() < child.creationDate.getTime() ||
    (parent.creationDate.getTime() === child.creationDate.getTime() && parent.id < child.id);
  return parentIsOlder ? "ahead" : undefined;
}

function healthOf(c: Candidate): StackHealth {
  if (c.parent.status === "completed") return "parent-merged";
  if (c.parent.status === "abandoned") return "parent-abandoned";
  return c.inSync ? "in-sync" : "parent-ahead";
}

/** Manual parents can introduce cycles; drop the edge that closes one. */
function breakCycles(chosen: Map<number, Candidate>): void {
  for (const start of [...chosen.keys()]) {
    const seen = new Set<number>([start]);
    let cur = chosen.get(start)?.parent.id;
    while (cur !== undefined) {
      if (seen.has(cur)) {
        chosen.delete(start);
        break;
      }
      seen.add(cur);
      cur = chosen.get(cur)?.parent.id;
    }
  }
}

/** Flattens the forest depth-first for rendering as an indented list. */
export function flattenForest(forest: StackForest, include?: (n: StackNode) => boolean): StackNode[] {
  const out: StackNode[] = [];
  const walk = (id: number) => {
    const node = forest.nodes.get(id)!;
    if (!include || include(node)) out.push(node);
    for (const c of node.childIds) walk(c);
  };
  for (const r of forest.rootIds) walk(r);
  return out;
}

/** True when the PR has at least one stacked relative (parent or child). */
export function isStacked(node: StackNode): boolean {
  return node.parentId !== undefined || node.childIds.length > 0;
}
