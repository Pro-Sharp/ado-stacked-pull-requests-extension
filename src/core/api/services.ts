import * as SDK from "azure-devops-extension-sdk";
import { IProjectPageService, getClient } from "azure-devops-extension-api";
import {
  Comment,
  CommentThreadStatus,
  GitChange,
  GitPullRequest,
  GitPullRequestCommentThread,
  GitPullRequestIteration,
  GitPullRequestStatus,
  GitRepository,
  GitRestClient,
  GitVersionType,
  IdentityRefWithVote,
  PullRequestStatus,
  PullRequestTimeRangeType
} from "azure-devops-extension-api/Git";
import { PolicyEvaluationRecord, PolicyRestClient } from "azure-devops-extension-api/Policy";
import { AsyncCache, mapLimit, withRetry } from "./concurrency";
import { RawPullRequest, toPrInfo } from "./mapping";
import { detectStacks } from "../stack/detect";
import { PrInfo, StackForest } from "../stack/types";

export const PARENT_PROPERTY = "StackedPRs.ParentPullRequestId";
export const GATE_STATUS = { genre: "stacked-prs", name: "parent-merged" };

export interface ProjectContext {
  projectId: string;
  projectName: string;
  userId: string;
  userName: string;
}

export interface LoadOptions {
  /** Restrict to these repositories; empty/undefined means every repository in the project. */
  repositoryIds?: string[];
  /** Also pull PRs completed within this many days so merged parents can anchor their children. */
  completedDays?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface StackSnapshot {
  forest: StackForest;
  prs: PrInfo[];
  raw: Map<number, GitPullRequest>;
  repositories: GitRepository[];
}

export interface LayerFile {
  path: string;
  originalPath?: string;
  changeType: number;
  /** Blob ids on both sides (undefined when the file does not exist on that side). */
  oldObjectId?: string;
  newObjectId?: string;
}

export interface LayerRange {
  /** Commit the layer diff starts from (the merge base with the parent). */
  baseSha: string;
  /** Commit the layer diff ends at (the child's source tip). */
  headSha: string;
  files: LayerFile[];
}

export class StackedPrService {
  private readonly git = getClient(GitRestClient);
  private readonly policy = getClient(PolicyRestClient);
  private readonly commitCache = new AsyncCache<Set<string>>();
  private readonly fileCache = new AsyncCache<string>();
  private readonly mergeBaseCache = new AsyncCache<string>();

  constructor(readonly ctx: ProjectContext) {}

  static async create(): Promise<StackedPrService> {
    const projectService = await SDK.getService<IProjectPageService>("ms.vss-tfs-web.tfs-page-data-service");
    const project = await projectService.getProject();
    if (!project) throw new Error("No project context available");
    const user = SDK.getUser();
    return new StackedPrService({
      projectId: project.id,
      projectName: project.name,
      userId: user.id,
      userName: user.displayName
    });
  }

  // ---- list & stacks -----------------------------------------------------------------------

  async listRepositories(): Promise<GitRepository[]> {
    const repos = await this.git.getRepositories(this.ctx.projectName);
    return repos.filter((r) => !r.isDisabled).sort((a, b) => a.name.localeCompare(b.name));
  }

  private async fetchByStatus(status: PullRequestStatus, repoId: string | undefined, since?: Date): Promise<GitPullRequest[]> {
    const out: GitPullRequest[] = [];
    const pageSize = 100;
    for (let skip = 0; ; skip += pageSize) {
      const page = await withRetry(() =>
        this.git.getPullRequestsByProject(
          this.ctx.projectName,
          {
            status,
            repositoryId: repoId,
            minTime: since,
            queryTimeRangeType: since ? PullRequestTimeRangeType.Closed : undefined
          } as never,
          undefined,
          skip,
          pageSize
        )
      );
      out.push(...page);
      if (page.length < pageSize) break;
    }
    return out;
  }

  async loadStacks(options: LoadOptions = {}): Promise<StackSnapshot> {
    const repos = await this.listRepositories();
    const repoIds = options.repositoryIds?.length ? options.repositoryIds : [undefined];

    const rawList: GitPullRequest[] = [];
    for (const repoId of repoIds) {
      rawList.push(...(await this.fetchByStatus(PullRequestStatus.Active, repoId)));
      if (options.completedDays) {
        const since = new Date(Date.now() - options.completedDays * 86_400_000);
        rawList.push(...(await this.fetchByStatus(PullRequestStatus.Completed, repoId, since)));
      }
    }

    const raw = new Map(rawList.map((p) => [p.pullRequestId, p]));
    const prs = rawList.map((p) => toPrInfo(p as unknown as RawPullRequest));

    // Only PRs sharing repo+target with another PR can be "contained" stacks; others need no commit lookup.
    const groups = new Map<string, PrInfo[]>();
    for (const p of prs) {
      const k = `${p.repositoryId}|${p.targetRef}`;
      groups.set(k, [...(groups.get(k) ?? []), p]);
    }
    const needCommits = [...groups.values()].filter((g) => g.length > 1).flat();

    let done = 0;
    const commitsByPr = new Map<number, Set<string>>();
    await mapLimit(needCommits, 4, async (p) => {
      try {
        commitsByPr.set(p.id, await this.getPrCommitIds(p));
      } finally {
        options.onProgress?.(++done, needCommits.length);
      }
    });

    const manualParents = await this.loadManualParents(prs.filter((p) => p.status === "active"));
    return { forest: detectStacks(prs, { commitsByPr, manualParents }), prs, raw, repositories: repos };
  }

  getPrCommitIds(pr: PrInfo): Promise<Set<string>> {
    return this.commitCache.get(`${pr.repositoryId}:${pr.id}:${pr.headSha}`, async () => {
      const commits = await withRetry(() => this.git.getPullRequestCommits(pr.repositoryId, pr.id, this.ctx.projectName));
      return new Set(commits.map((c) => c.commitId));
    });
  }

  private async loadManualParents(prs: PrInfo[]): Promise<Map<number, number>> {
    const result = new Map<number, number>();
    await mapLimit(prs, 6, async (p) => {
      try {
        const props = await this.git.getPullRequestProperties(p.repositoryId, p.id, this.ctx.projectName);
        const value = props?.value?.[PARENT_PROPERTY]?.$value ?? props?.[PARENT_PROPERTY]?.$value;
        const parent = Number(value);
        if (parent > 0) result.set(p.id, parent);
      } catch {
        /* properties are optional */
      }
    });
    return result;
  }

  async setManualParent(pr: PrInfo, parentId: number | undefined): Promise<void> {
    const op = parentId === undefined ? "remove" : "add";
    await this.git.updatePullRequestProperties(
      [{ op, path: `/${PARENT_PROPERTY}`, value: parentId === undefined ? undefined : String(parentId) }] as never,
      pr.repositoryId,
      pr.id,
      this.ctx.projectName
    );
  }

  // ---- layer diff --------------------------------------------------------------------------

  /** Common ancestor of two commits (used as the base of the stack-layer diff). */
  getMergeBase(repoId: string, a: string, b: string): Promise<string> {
    return this.mergeBaseCache.get(`${repoId}:${a}:${b}`, async () => {
      const bases = await withRetry(() => this.git.getMergeBases(repoId, a, b, this.ctx.projectName));
      if (!bases.length) throw new Error(`No merge base between ${a.slice(0, 8)} and ${b.slice(0, 8)}`);
      return bases[0].commitId;
    });
  }

  /** Files changed by `head` relative to `base`, with paging. */
  async diffCommits(repoId: string, baseSha: string, headSha: string): Promise<LayerFile[]> {
    const files: LayerFile[] = [];
    const top = 1000;
    for (let skip = 0; ; skip += top) {
      const diff = await withRetry(() =>
        this.git.getCommitDiffs(
          repoId,
          this.ctx.projectName,
          false,
          top,
          skip,
          { baseVersion: baseSha, baseVersionType: GitVersionType.Commit } as never,
          { targetVersion: headSha, targetVersionType: GitVersionType.Commit } as never
        )
      );
      for (const c of diff.changes ?? []) {
        if (c.item?.isFolder) continue;
        files.push(toLayerFile(c));
      }
      if (diff.allChangesIncluded || !(diff.changes?.length >= top)) break;
    }
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  async getLayerRange(child: PrInfo, parent: PrInfo): Promise<LayerRange> {
    const baseSha = await this.getMergeBase(child.repositoryId, parent.headSha, child.headSha);
    const files = await this.diffCommits(child.repositoryId, baseSha, child.headSha);
    return { baseSha, headSha: child.headSha, files };
  }

  /** Files for the native "all changes" view: latest iteration against the PR's merge base. */
  async getNativeChanges(pr: PrInfo, iterationId: number, compareTo = 0): Promise<(LayerFile & { changeTrackingId: number })[]> {
    const out: (LayerFile & { changeTrackingId: number })[] = [];
    let skip = 0;
    while (true) {
      const page = await withRetry(() =>
        this.git.getPullRequestIterationChanges(pr.repositoryId, pr.id, iterationId, this.ctx.projectName, 2000, skip, compareTo)
      );
      for (const c of page.changeEntries ?? []) {
        if (c.item?.isFolder) continue;
        out.push({ ...toLayerFile(c), changeTrackingId: c.changeTrackingId });
      }
      if (!page.nextSkip) break;
      skip = page.nextSkip;
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Text of a file at a commit; missing files resolve to an empty string. Blobs are immutable so this is cached forever. */
  getFileText(repoId: string, path: string, sha: string): Promise<string> {
    return this.fileCache.get(`${repoId}:${sha}:${path}`, async () => {
      try {
        return await withRetry(() =>
          this.git.getItemText(
            repoId,
            path,
            this.ctx.projectName,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            { version: sha, versionType: GitVersionType.Commit } as never,
            true
          )
        );
      } catch (e) {
        if ((e as { status?: number }).status === 404) return "";
        throw e;
      }
    });
  }

  // ---- PR detail ---------------------------------------------------------------------------

  getPullRequest(repoId: string, id: number): Promise<GitPullRequest> {
    return this.git.getPullRequest(repoId, id, this.ctx.projectName, undefined, undefined, undefined, false, true);
  }

  getIterations(repoId: string, id: number): Promise<GitPullRequestIteration[]> {
    return this.git.getPullRequestIterations(repoId, id, this.ctx.projectName);
  }

  getIterationCommits(repoId: string, id: number, iterationId: number) {
    return this.git.getPullRequestIterationCommits(repoId, id, iterationId, this.ctx.projectName);
  }

  async getCommits(repoId: string, id: number) {
    return this.git.getPullRequestCommits(repoId, id, this.ctx.projectName);
  }

  getThreads(repoId: string, id: number, iteration?: number): Promise<GitPullRequestCommentThread[]> {
    return this.git.getThreads(repoId, id, this.ctx.projectName, iteration, iteration ? 0 : undefined);
  }

  getStatuses(repoId: string, id: number): Promise<GitPullRequestStatus[]> {
    return this.git.getPullRequestStatuses(repoId, id, this.ctx.projectName);
  }

  getWorkItemRefs(repoId: string, id: number) {
    return this.git.getPullRequestWorkItemRefs(repoId, id, this.ctx.projectName);
  }

  async getPolicyEvaluations(id: number): Promise<PolicyEvaluationRecord[]> {
    const artifactId = `vstfs:///CodeReview/CodeReviewId/${this.ctx.projectId}/${id}`;
    try {
      return await this.policy.getPolicyEvaluations(this.ctx.projectId, artifactId);
    } catch {
      return [];
    }
  }

  requeuePolicy(evaluationId: string): Promise<PolicyEvaluationRecord> {
    return this.policy.requeuePolicyEvaluation(this.ctx.projectId, evaluationId);
  }

  // ---- review actions (always on the selected PR, never on its parent) ---------------------

  vote(pr: PrInfo, vote: number): Promise<IdentityRefWithVote> {
    return this.git.createPullRequestReviewer({ vote, id: this.ctx.userId } as IdentityRefWithVote, pr.repositoryId, pr.id, this.ctx.userId, this.ctx.projectName);
  }

  addReviewer(pr: PrInfo, reviewerId: string, isRequired: boolean): Promise<IdentityRefWithVote> {
    return this.git.createPullRequestReviewer({ id: reviewerId, isRequired, vote: 0 } as IdentityRefWithVote, pr.repositoryId, pr.id, reviewerId, this.ctx.projectName);
  }

  removeReviewer(pr: PrInfo, reviewerId: string): Promise<void> {
    return this.git.deletePullRequestReviewer(pr.repositoryId, pr.id, reviewerId, this.ctx.projectName);
  }

  updatePullRequest(pr: PrInfo, patch: Partial<GitPullRequest>): Promise<GitPullRequest> {
    return this.git.updatePullRequest(patch as GitPullRequest, pr.repositoryId, pr.id, this.ctx.projectName);
  }

  retarget(pr: PrInfo, targetRefName: string): Promise<GitPullRequest> {
    return this.updatePullRequest(pr, { targetRefName });
  }

  async addComment(pr: PrInfo, threadId: number, content: string): Promise<Comment> {
    return this.git.createComment({ content, parentCommentId: 1, commentType: 1 } as Comment, pr.repositoryId, pr.id, threadId, this.ctx.projectName);
  }

  editComment(pr: PrInfo, threadId: number, commentId: number, content: string): Promise<Comment> {
    return this.git.updateComment({ content } as Comment, pr.repositoryId, pr.id, threadId, commentId, this.ctx.projectName);
  }

  deleteComment(pr: PrInfo, threadId: number, commentId: number): Promise<void> {
    return this.git.deleteComment(pr.repositoryId, pr.id, threadId, commentId, this.ctx.projectName);
  }

  setThreadStatus(pr: PrInfo, threadId: number, status: CommentThreadStatus): Promise<GitPullRequestCommentThread> {
    return this.git.updateThread({ status } as GitPullRequestCommentThread, pr.repositoryId, pr.id, threadId, this.ctx.projectName);
  }

  like(pr: PrInfo, threadId: number, commentId: number, liked: boolean): Promise<void> {
    return liked
      ? this.git.createLike(pr.repositoryId, pr.id, threadId, commentId, this.ctx.projectName)
      : this.git.deleteLike(pr.repositoryId, pr.id, threadId, commentId, this.ctx.projectName);
  }

  createThread(pr: PrInfo, thread: GitPullRequestCommentThread): Promise<GitPullRequestCommentThread> {
    return this.git.createThread(thread, pr.repositoryId, pr.id, this.ctx.projectName);
  }

  /** Identity search for the reviewer picker (Identity Picker REST API, needs the vso.identity scope). */
  async searchIdentities(query: string): Promise<{ id: string; displayName: string; mail?: string }[]> {
    if (query.trim().length < 2) return [];
    const token = await SDK.getAccessToken();
    const org = SDK.getHost().name;
    const res = await fetch(`https://dev.azure.com/${org}/_apis/IdentityPicker/Identities?api-version=7.1-preview.1`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        query,
        identityTypes: ["user", "group"],
        operationScopes: ["ims", "source"],
        options: { MinResults: 5, MaxResults: 8 },
        properties: ["DisplayName", "Mail", "LocalId"]
      })
    });
    if (!res.ok) throw new Error(`Identity search failed (${res.status})`);
    const body = await res.json();
    const found = (body.results?.[0]?.identities ?? []) as { localId?: string; entityId?: string; displayName: string; mail?: string }[];
    return found.filter((i) => i.localId).map((i) => ({ id: i.localId!, displayName: i.displayName, mail: i.mail }));
  }

  addLabel(pr: PrInfo, name: string) {
    return this.git.createPullRequestLabel({ name } as never, pr.repositoryId, pr.id, this.ctx.projectName, this.ctx.projectId);
  }

  removeLabel(pr: PrInfo, name: string) {
    return this.git.deletePullRequestLabels(pr.repositoryId, pr.id, name, this.ctx.projectName, this.ctx.projectId);
  }

  /** Posts / refreshes the optional "parent merged" gate status that a branch policy can require. */
  async postGateStatus(pr: PrInfo, parentOpen: boolean, parentId: number): Promise<void> {
    await this.git.createPullRequestStatus(
      {
        context: GATE_STATUS,
        state: parentOpen ? 1 /* pending */ : 2 /* succeeded */,
        description: parentOpen ? `Waiting for parent PR !${parentId} to complete` : `Parent PR !${parentId} is completed`
      } as unknown as GitPullRequestStatus,
      pr.repositoryId,
      pr.id,
      this.ctx.projectName
    );
  }
}

function toLayerFile(c: GitChange): LayerFile {
  const type = c.changeType as number;
  const isDelete = (type & 16) !== 0;
  const isAdd = (type & 1) !== 0;
  return {
    path: c.item?.path ?? "",
    originalPath: c.originalPath,
    changeType: type,
    oldObjectId: isAdd ? undefined : c.item?.originalObjectId,
    newObjectId: isDelete ? undefined : c.item?.objectId
  };
}
