/**
 * Domain model used by the stack engine. It is deliberately independent of the
 * azure-devops-extension-api types so the engine stays pure and unit-testable;
 * `core/api/mapping.ts` converts REST payloads into these shapes.
 */

export type PrStatus = "active" | "completed" | "abandoned";

export interface PrInfo {
  id: number;
  repositoryId: string;
  repositoryName: string;
  title: string;
  isDraft: boolean;
  status: PrStatus;
  /** Full ref name, e.g. `refs/heads/feature/a`. */
  sourceRef: string;
  /** Full ref name, e.g. `refs/heads/main`. */
  targetRef: string;
  /** `lastMergeSourceCommit` - the tip of the source branch the PR was last evaluated at. */
  headSha: string;
  /** `lastMergeTargetCommit` - the tip of the target branch the PR was last evaluated at. */
  targetSha?: string;
  mergeStatus?: "succeeded" | "conflicts" | "queued" | "rejectedByPolicy" | "failure" | "notSet";
  authorId?: string;
  authorName?: string;
  creationDate: Date;
}

export type Relation = "root" | "explicit" | "contained" | "manual";

export type StackHealth =
  /** Not stacked on anything. */
  | "root"
  /** Parent is open and the child contains the parent's latest commit. */
  | "in-sync"
  /** Parent has newer commits than the child contains: the child needs restacking. */
  | "parent-ahead"
  /** Parent PR is completed; the child should be retargeted / rebased onto the trunk. */
  | "parent-merged"
  /** Parent PR was abandoned. */
  | "parent-abandoned";

export interface StackNode {
  pr: PrInfo;
  parentId?: number;
  childIds: number[];
  relation: Relation;
  health: StackHealth;
  hasConflicts: boolean;
  /** Distance from the stack root (0 for roots). */
  depth: number;
  /** Id of the root PR of the stack this node belongs to. */
  stackRootId: number;
}

export interface StackForest {
  nodes: Map<number, StackNode>;
  /** Root node ids in stable display order. */
  rootIds: number[];
}

export interface DetectOptions {
  /** PR id -> set of commit ids contained in that PR (`GET pullRequests/{id}/commits`). */
  commitsByPr: Map<number, Set<string>>;
  /** child PR id -> parent PR id, set explicitly by the user (PR property). */
  manualParents?: Map<number, number>;
}
