export interface TreeFile {
  path: string;
}

export interface TreeNode<T extends TreeFile> {
  name: string;
  /** Full path of the folder (or file). */
  path: string;
  file?: T;
  children: TreeNode<T>[];
}

/** Builds a folder tree from flat file paths; folders first, then files, each sorted by name. */
export function buildTree<T extends TreeFile>(files: T[]): TreeNode<T>[] {
  const root: TreeNode<T> = { name: "", path: "", children: [] };
  for (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    let cur = root;
    parts.forEach((part, i) => {
      const path = "/" + parts.slice(0, i + 1).join("/");
      let next = cur.children.find((c) => c.path === path);
      if (!next) {
        next = { name: part, path, children: [] };
        cur.children.push(next);
      }
      if (i === parts.length - 1) next.file = f;
      cur = next;
    });
  }
  const sort = (n: TreeNode<T>) => {
    n.children.sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name));
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

/** Flattens a tree into rows honouring collapsed folders. */
export function flattenTree<T extends TreeFile>(nodes: TreeNode<T>[], collapsed: Set<string>, depth = 0): { node: TreeNode<T>; depth: number }[] {
  const out: { node: TreeNode<T>; depth: number }[] = [];
  for (const n of nodes) {
    out.push({ node: n, depth });
    if (!n.file && !collapsed.has(n.path)) out.push(...flattenTree(n.children, collapsed, depth + 1));
  }
  return out;
}

/** Single-letter change marker used in the file tree: A(dd) / M(odify) / D(elete) / R(ename). */
export function changeLetter(changeType: number): "A" | "M" | "D" | "R" {
  if (changeType & 16) return "D";
  if (changeType & 1) return "A";
  if (changeType & (8 | 1024 | 2048)) return "R";
  return "M";
}
