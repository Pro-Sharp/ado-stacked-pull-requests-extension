import { PrInfo, PrStatus } from "../stack/types";

/** Minimal structural subset of `GitPullRequest` we read; keeps mapping testable without the SDK. */
export interface RawPullRequest {
  pullRequestId: number;
  repository: { id: string; name: string };
  title: string;
  isDraft?: boolean;
  status: number;
  sourceRefName: string;
  targetRefName: string;
  lastMergeSourceCommit?: { commitId: string };
  lastMergeTargetCommit?: { commitId: string };
  mergeStatus?: number;
  createdBy?: { id: string; displayName: string };
  creationDate: Date | string;
}

const STATUS: Record<number, PrStatus> = { 1: "active", 2: "abandoned", 3: "completed" };
const MERGE: Record<number, NonNullable<PrInfo["mergeStatus"]>> = {
  0: "notSet",
  1: "queued",
  2: "conflicts",
  3: "succeeded",
  4: "rejectedByPolicy",
  5: "failure"
};

export function toPrInfo(raw: RawPullRequest): PrInfo {
  return {
    id: raw.pullRequestId,
    repositoryId: raw.repository.id,
    repositoryName: raw.repository.name,
    title: raw.title,
    isDraft: !!raw.isDraft,
    status: STATUS[raw.status] ?? "active",
    sourceRef: raw.sourceRefName,
    targetRef: raw.targetRefName,
    headSha: raw.lastMergeSourceCommit?.commitId ?? "",
    targetSha: raw.lastMergeTargetCommit?.commitId,
    mergeStatus: raw.mergeStatus === undefined ? undefined : MERGE[raw.mergeStatus],
    authorId: raw.createdBy?.id,
    authorName: raw.createdBy?.displayName,
    creationDate: new Date(raw.creationDate)
  };
}

/** `refs/heads/feature/x` -> `feature/x`. */
export function shortRef(ref: string): string {
  return ref.replace(/^refs\/heads\//, "").replace(/^refs\/tags\//, "");
}

export type VoteKind = "approved" | "approved-with-suggestions" | "none" | "waiting" | "rejected";

export const VOTE_VALUES: Record<VoteKind, number> = {
  approved: 10,
  "approved-with-suggestions": 5,
  none: 0,
  waiting: -5,
  rejected: -10
};

export function voteKind(vote: number): VoteKind {
  if (vote >= 10) return "approved";
  if (vote >= 5) return "approved-with-suggestions";
  if (vote <= -10) return "rejected";
  if (vote <= -5) return "waiting";
  return "none";
}

export const VOTE_LABELS: Record<VoteKind, string> = {
  approved: "Approved",
  "approved-with-suggestions": "Approved with suggestions",
  none: "No vote",
  waiting: "Waiting for the author",
  rejected: "Rejected"
};

/** Convenience: label for a numeric vote. */
export function voteLabel(vote: number): string {
  return VOTE_LABELS[voteKind(vote)];
}

/**
 * Summarises reviewer votes for the list view. Required reviewers that have not
 * voted (or are waiting/rejecting) block the PR.
 */
export function reviewSummary(reviewers: { vote: number; isRequired?: boolean }[]): {
  approved: number;
  waiting: number;
  rejected: number;
  pending: number;
  blockedByRequired: boolean;
} {
  let approved = 0;
  let waiting = 0;
  let rejected = 0;
  let pending = 0;
  let blockedByRequired = false;
  for (const r of reviewers) {
    const k = voteKind(r.vote);
    if (k === "approved" || k === "approved-with-suggestions") approved++;
    else if (k === "waiting") waiting++;
    else if (k === "rejected") rejected++;
    else pending++;
    if (r.isRequired && (k === "none" || k === "waiting" || k === "rejected")) blockedByRequired = true;
  }
  return { approved, waiting, rejected, pending, blockedByRequired };
}
