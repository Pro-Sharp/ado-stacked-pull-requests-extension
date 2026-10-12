import { StackForest, StackNode } from "./types";

export interface StackRow {
  node: StackNode;
  /** Box-drawing prefix, e.g. `│  └─ `. Empty for the root. */
  prefix: string;
}

/** Lays a stack out as an ASCII tree, depth-first. */
export function stackRows(forest: StackForest, rootId: number): StackRow[] {
  const rows: StackRow[] = [];
  const walk = (id: number, ancestorsLast: boolean[], isLast: boolean, isRoot: boolean) => {
    const node = forest.nodes.get(id)!;
    const base = ancestorsLast.map((last) => (last ? "   " : "│  ")).join("");
    rows.push({ node, prefix: isRoot ? "" : base + (isLast ? "└─ " : "├─ ") });
    const next = isRoot ? [] : [...ancestorsLast, isLast];
    node.childIds.forEach((cid, i) => walk(cid, next, i === node.childIds.length - 1, false));
  };
  walk(rootId, [], true, true);
  return rows;
}
