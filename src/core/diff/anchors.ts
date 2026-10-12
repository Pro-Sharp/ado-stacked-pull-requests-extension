import { DiffRow } from "./lineDiff";

/**
 * Where a review comment made in the stack-layer diff should be anchored on
 * the real pull request so the native PR page shows it on the right line.
 */
export interface CommentAnchor {
  /** Anchor in the right (new) file, i.e. the PR's source tip. Absent for file-level comments. */
  rightLine?: number;
  /** Anchor in the left (old) file, only when the left side is shared with the native view. */
  leftLine?: number;
  /** When the anchor is an approximation, text to prepend to the comment so the intent is preserved. */
  quote?: string;
}

/**
 * Right-side lines (added or unchanged) are identical in the layer diff and the
 * native diff, because both use the PR's source tip. Deleted lines only exist on
 * the layer diff's left side (parent tip), which the native view does not show
 * unless the PR targets the parent branch, so we approximate.
 *
 * @param nativeLeftLines lines of the file as the native view sees its left side (merge base with
 *        the PR target); used to locate a deleted line when it also exists there. Pass undefined
 *        when unknown.
 */
export function anchorForRow(row: DiffRow, rows: DiffRow[], nativeLeftLines?: string[]): CommentAnchor {
  if (row.type === "add" || row.type === "context") {
    return { rightLine: row.newLine };
  }
  if (row.type !== "delete") return {};

  if (nativeLeftLines) {
    const hit = findInWindow(nativeLeftLines, row.text, row.oldLine ?? 1);
    if (hit !== undefined) return { leftLine: hit };
  }

  const next = nextRightLine(row, rows);
  const quote = `> Removed in this change (line ${row.oldLine}): \`${row.text.trim()}\`\n\n`;
  return next !== undefined ? { rightLine: next, quote } : { quote };
}

/** Searches a ±window around `hint` (1-based) for a line equal to `text`. */
export function findInWindow(lines: string[], text: string, hint: number, window = 25): number | undefined {
  let best: number | undefined;
  for (let d = 0; d <= window; d++) {
    for (const idx of d === 0 ? [hint] : [hint - d, hint + d]) {
      if (idx >= 1 && idx <= lines.length && lines[idx - 1] === text) {
        best = idx;
        return best;
      }
    }
  }
  return best;
}

function nextRightLine(row: DiffRow, rows: DiffRow[]): number | undefined {
  const i = rows.indexOf(row);
  for (let k = i + 1; k < rows.length; k++) if (rows[k].newLine !== undefined) return rows[k].newLine;
  for (let k = i - 1; k >= 0; k--) if (rows[k].newLine !== undefined) return rows[k].newLine;
  return undefined;
}
