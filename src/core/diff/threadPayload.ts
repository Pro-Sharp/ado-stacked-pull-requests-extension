import { CommentAnchor } from "./anchors";

export interface NewThreadInput {
  filePath: string;
  anchor: CommentAnchor;
  text: string;
  /** Latest iteration of the pull request the comment is posted to. */
  iterationId: number;
  /** From the PR's native iteration changes; required by the API for iteration-aware PRs. */
  changeTrackingId?: number;
  /** Length of the anchored line, used for the end offset of the comment range. */
  lineLength?: number;
}

export interface NewThreadPayload {
  comments: { parentCommentId: number; content: string; commentType: number }[];
  status: number;
  threadContext?: {
    filePath: string;
    rightFileStart?: { line: number; offset: number };
    rightFileEnd?: { line: number; offset: number };
    leftFileStart?: { line: number; offset: number };
    leftFileEnd?: { line: number; offset: number };
  };
  pullRequestThreadContext?: {
    changeTrackingId: number;
    iterationContext: { firstComparingIteration: number; secondComparingIteration: number };
  };
}

/**
 * Builds the body for `POST pullRequests/{id}/threads`.
 *
 * Returns `undefined` when the comment cannot be attached to a line of the
 * native diff (no change-tracking id or no usable line). The caller then posts
 * a PR-level comment that quotes the location instead.
 */
export function buildThreadPayload(input: NewThreadInput): NewThreadPayload | undefined {
  const { anchor, filePath, text, iterationId, changeTrackingId, lineLength = 1 } = input;
  if (changeTrackingId === undefined) return undefined;
  if (anchor.rightLine === undefined && anchor.leftLine === undefined) return undefined;

  const content = (anchor.quote ?? "") + text;
  const threadContext: NonNullable<NewThreadPayload["threadContext"]> = { filePath };
  if (anchor.leftLine !== undefined) {
    threadContext.leftFileStart = { line: anchor.leftLine, offset: 1 };
    threadContext.leftFileEnd = { line: anchor.leftLine, offset: Math.max(2, lineLength + 1) };
  } else {
    threadContext.rightFileStart = { line: anchor.rightLine!, offset: 1 };
    threadContext.rightFileEnd = { line: anchor.rightLine!, offset: Math.max(2, lineLength + 1) };
  }
  return {
    comments: [{ parentCommentId: 0, content, commentType: 1 }],
    status: 1,
    threadContext,
    pullRequestThreadContext: {
      changeTrackingId,
      iterationContext: { firstComparingIteration: iterationId, secondComparingIteration: iterationId }
    }
  };
}

/** Text used for a PR-level comment when a line anchor is impossible. */
export function fallbackComment(filePath: string, anchor: CommentAnchor, text: string, line?: number): string {
  const where = line ?? anchor.rightLine ?? anchor.leftLine;
  return `**${filePath}${where ? `:${where}` : ""}**\n\n${anchor.quote ?? ""}${text}`;
}
