import { DiffRow } from "./lineDiff";

/** Minimal structural view of a PR comment thread (subset of GitPullRequestCommentThread). */
export interface ThreadLike {
  id: number;
  isDeleted?: boolean;
  status?: number;
  threadContext?: {
    filePath?: string;
    rightFileStart?: { line: number };
    rightFileEnd?: { line: number };
    leftFileStart?: { line: number };
  } | null;
  comments?: { commentType?: number | string; isDeleted?: boolean }[];
}

export const THREAD_ACTIVE = 1;
export const THREAD_PENDING = 6;

export function isResolved(t: ThreadLike): boolean {
  return t.status !== undefined && t.status !== THREAD_ACTIVE && t.status !== THREAD_PENDING && t.status !== 0;
}

/** System threads (vote changes, pushes...) only contain system comments. */
export function isSystemThread(t: ThreadLike): boolean {
  const cs = (t.comments ?? []).filter((c) => !c.isDeleted);
  if (cs.length === 0) return false;
  return cs.every((c) => c.commentType === 3 || c.commentType === "system");
}

export function threadPath(t: ThreadLike): string | undefined {
  return t.threadContext?.filePath || undefined;
}

export function threadLine(t: ThreadLike): number | undefined {
  return t.threadContext?.rightFileStart?.line ?? t.threadContext?.leftFileStart?.line;
}

export interface PlacedThreads<T extends ThreadLike> {
  /** Threads keyed by the right-file line they attach to. */
  inline: Map<number, T[]>;
  /** Threads on this file that match no visible row (collapsed lines, deleted lines, file level). */
  fileLevel: T[];
}

/** Attaches the threads of one file to the visible diff rows. */
export function placeThreads<T extends ThreadLike>(threads: T[], rows: DiffRow[]): PlacedThreads<T> {
  const visible = new Set<number>();
  for (const r of rows) if (r.newLine !== undefined) visible.add(r.newLine);
  const inline = new Map<number, T[]>();
  const fileLevel: T[] = [];
  for (const t of threads) {
    const line = t.threadContext?.rightFileStart?.line;
    if (line !== undefined && visible.has(line)) {
      const arr = inline.get(line) ?? [];
      arr.push(t);
      inline.set(line, arr);
    } else {
      fileLevel.push(t);
    }
  }
  return { inline, fileLevel };
}

export interface ThreadBuckets<T extends ThreadLike> {
  /** File comments, by path, for files that belong to the displayed layer. */
  byFile: Map<string, T[]>;
  /** Comments on files that are not part of this layer (they belong to a parent PR's changes). */
  inherited: T[];
  /** Comments not attached to a file. */
  general: T[];
}

/** Splits all non-system, non-deleted threads of a PR for the stack-layer view. */
export function bucketThreads<T extends ThreadLike>(threads: T[], layerFiles: Set<string>): ThreadBuckets<T> {
  const byFile = new Map<string, T[]>();
  const inherited: T[] = [];
  const general: T[] = [];
  for (const t of threads) {
    if (t.isDeleted || isSystemThread(t)) continue;
    const path = threadPath(t);
    if (!path) {
      general.push(t);
    } else if (layerFiles.has(path)) {
      const arr = byFile.get(path) ?? [];
      arr.push(t);
      byFile.set(path, arr);
    } else {
      inherited.push(t);
    }
  }
  return { byFile, inherited, general };
}

export function countResolved<T extends ThreadLike>(threads: T[]): { resolved: number; total: number } {
  const real = threads.filter((t) => !t.isDeleted && !isSystemThread(t));
  return { resolved: real.filter(isResolved).length, total: real.length };
}
