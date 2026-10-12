import { diffLines } from "diff";

export type RowType = "context" | "add" | "delete" | "gap";

export interface DiffRow {
  type: RowType;
  /** 1-based line number in the old (left) file, if the row exists there. */
  oldLine?: number;
  /** 1-based line number in the new (right) file, if the row exists there. */
  newLine?: number;
  text: string;
  /** For `gap` rows: how many unchanged lines are collapsed. */
  hidden?: number;
  /** For `gap` rows: first hidden new-file line, used to expand the gap. */
  gapStartNew?: number;
}

export interface DiffResult {
  rows: DiffRow[];
  added: number;
  removed: number;
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Computes a unified-style row list between two file versions. Unchanged runs
 * longer than `2 * context` lines are collapsed into a `gap` row.
 */
export function buildDiffRows(oldText: string, newText: string, context = 3): DiffResult {
  const parts = diffLines(oldText, newText);
  const all: DiffRow[] = [];
  let oldLine = 1;
  let newLine = 1;
  let added = 0;
  let removed = 0;

  for (const part of parts) {
    const lines = splitLines(part.value);
    for (const text of lines) {
      if (part.added) {
        all.push({ type: "add", newLine: newLine++, text });
        added++;
      } else if (part.removed) {
        all.push({ type: "delete", oldLine: oldLine++, text });
        removed++;
      } else {
        all.push({ type: "context", oldLine: oldLine++, newLine: newLine++, text });
      }
    }
  }

  if (context < 0) return { rows: all, added, removed };

  // Collapse long unchanged runs.
  const keep = new Array<boolean>(all.length).fill(false);
  all.forEach((row, i) => {
    if (row.type === "context") return;
    for (let k = Math.max(0, i - context); k <= Math.min(all.length - 1, i + context); k++) keep[k] = true;
  });

  const rows: DiffRow[] = [];
  let i = 0;
  while (i < all.length) {
    if (keep[i]) {
      rows.push(all[i++]);
      continue;
    }
    const start = i;
    while (i < all.length && !keep[i]) i++;
    rows.push({
      type: "gap",
      text: "",
      hidden: i - start,
      gapStartNew: all[start].newLine
    });
  }
  return { rows, added, removed };
}

/** Expands a collapsed gap back into context rows using the full file text. */
export function expandGap(gap: DiffRow, fullRows: DiffRow[]): DiffRow[] {
  const start = fullRows.findIndex((r) => r.type === "context" && r.newLine === gap.gapStartNew);
  if (start < 0) return [];
  return fullRows.slice(start, start + (gap.hidden ?? 0));
}
