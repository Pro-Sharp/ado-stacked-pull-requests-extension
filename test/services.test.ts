import { beforeEach, describe, expect, it, vi } from "vitest";

// One fake object stands in for both the Git and Policy REST clients.
const fake: Record<string, ReturnType<typeof vi.fn>> = {};
vi.mock("azure-devops-extension-api", () => ({ getClient: () => fake }));
vi.mock("azure-devops-extension-sdk", () => ({ getAccessToken: async () => "t", getHost: () => ({ name: "org" }), getUser: () => ({ id: "me", displayName: "Me" }), getService: vi.fn() }));
vi.mock("azure-devops-extension-api/Git", () => ({ GitRestClient: class {}, GitVersionType: { Commit: 2 }, PullRequestStatus: { Active: 1, Completed: 3 }, PullRequestTimeRangeType: { Closed: 2 } }));
vi.mock("azure-devops-extension-api/Policy", () => ({ PolicyRestClient: class {} }));

import { PARENT_PROPERTY, StackedPrService } from "../src/core/api/services";
import { PrInfo } from "../src/core/stack/types";

const ctx = { projectId: "pid", projectName: "Proj", userId: "me", userName: "Me" };
const repo = { id: "r1", name: "Repo" };

function rawPr(id: number, source: string, head: string, over: Record<string, unknown> = {}) {
  return {
    pullRequestId: id,
    repository: repo,
    title: `PR ${id}`,
    isDraft: false,
    status: 1,
    sourceRefName: `refs/heads/${source}`,
    targetRefName: "refs/heads/main",
    lastMergeSourceCommit: { commitId: head },
    lastMergeTargetCommit: { commitId: "t0" },
    createdBy: { id: "u", displayName: "U" },
    creationDate: new Date(2026, 0, id).toISOString(),
    reviewers: [],
    ...over
  };
}

const pr = (id: number, head: string): PrInfo => ({
  id, repositoryId: "r1", repositoryName: "Repo", title: "t", isDraft: false, status: "active", sourceRef: "refs/heads/x", targetRef: "refs/heads/main", headSha: head, creationDate: new Date()
});

beforeEach(() => {
  for (const k of Object.keys(fake)) delete fake[k];
  fake.getRepositories = vi.fn().mockResolvedValue([repo]);
  fake.getPullRequestProperties = vi.fn().mockResolvedValue({});
});

describe("StackedPrService.loadStacks", () => {
  it("detects a stack across PRs and only fetches commits for PRs that share a target", async () => {
    fake.getPullRequestsByProject = vi.fn().mockResolvedValue([
      rawPr(1, "a", "a1"),
      rawPr(2, "b", "b1"),
      rawPr(3, "z", "z1", { targetRefName: "refs/heads/release" })
    ]);
    fake.getPullRequestCommits = vi.fn(async (_r: string, id: number) => (id === 1 ? [{ commitId: "a1" }] : [{ commitId: "a1" }, { commitId: "b1" }]));
    const snap = await new StackedPrService(ctx).loadStacks();
    expect(snap.forest.nodes.get(2)!.parentId).toBe(1);
    expect(snap.forest.nodes.get(3)!.parentId).toBeUndefined();
    expect(fake.getPullRequestCommits).toHaveBeenCalledTimes(2); // PR 3 is alone on its target
  });

  it("pages through project results", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => rawPr(i + 1, `b${i}`, `h${i}`, { targetRefName: `refs/heads/t${i}` }));
    fake.getPullRequestsByProject = vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce([rawPr(101, "x", "hx")]);
    const snap = await new StackedPrService(ctx).loadStacks();
    expect(snap.prs).toHaveLength(101);
    expect(fake.getPullRequestsByProject).toHaveBeenCalledTimes(2);
  });

  it("queries each selected repository and honours manual parent properties", async () => {
    fake.getPullRequestsByProject = vi.fn().mockResolvedValue([rawPr(1, "a", "a1"), rawPr(2, "b", "b1", { targetRefName: "refs/heads/other" })]);
    fake.getPullRequestProperties = vi.fn(async (_r: string, id: number) => (id === 2 ? { value: { [PARENT_PROPERTY]: { $value: "1" } } } : {}));
    fake.getPullRequestCommits = vi.fn().mockResolvedValue([]);
    const snap = await new StackedPrService(ctx).loadStacks({ repositoryIds: ["r1"] });
    expect(fake.getPullRequestsByProject.mock.calls[0][1]).toMatchObject({ repositoryId: "r1" });
    expect(snap.forest.nodes.get(2)).toMatchObject({ parentId: 1, relation: "manual" });
  });
});

describe("progressive loading", () => {
  it("emits provisional snapshots while pages and commits are still arriving", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => rawPr(i + 1, `b${i}`, `h${i}`, { targetRefName: `refs/heads/t${i}` }));
    fake.getPullRequestsByProject = vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce([rawPr(101, "x", "hx", { targetRefName: "refs/heads/t0" })]);
    fake.getPullRequestCommits = vi.fn().mockResolvedValue([]);
    const sizes: number[] = [];
    const snap = await new StackedPrService(ctx).loadStacks({ onPartial: (s) => sizes.push(s.prs.length) });
    expect(sizes[0]).toBe(100); // the first page is shown before the second one was requested
    expect(sizes).toContain(101);
    expect(snap.prs).toHaveLength(101);
    expect(snap.repositories).toEqual([repo]);
  });

  it("stops issuing requests once cancelled", async () => {
    fake.getPullRequestsByProject = vi.fn().mockResolvedValue(Array.from({ length: 100 }, (_, i) => rawPr(i + 1, `b${i}`, `h${i}`)));
    fake.getPullRequestCommits = vi.fn().mockResolvedValue([]);
    let stop = false;
    await new StackedPrService(ctx).loadStacks({ onPartial: () => (stop = true), cancelled: () => stop });
    expect(fake.getPullRequestsByProject).toHaveBeenCalledTimes(1);
    expect(fake.getPullRequestCommits).not.toHaveBeenCalled();
  });

  it("keeps rendering when a single PR's commit lookup fails", async () => {
    fake.getPullRequestsByProject = vi.fn().mockResolvedValue([rawPr(1, "a", "a1"), rawPr(2, "b", "b1")]);
    fake.getPullRequestCommits = vi.fn(async (_r: string, id: number) => {
      if (id === 1) throw { status: 404 };
      return [{ commitId: "b1" }];
    });
    const snap = await new StackedPrService(ctx).loadStacks();
    expect(snap.prs).toHaveLength(2);
  });

  it("streams native change pages as they arrive", async () => {
    fake.getPullRequestIterationChanges = vi
      .fn()
      .mockResolvedValueOnce({ changeEntries: [{ changeType: 2, changeTrackingId: 1, item: { path: "/b.ts" } }], nextSkip: 500 })
      .mockResolvedValueOnce({ changeEntries: [{ changeType: 2, changeTrackingId: 2, item: { path: "/a.ts" } }], nextSkip: 0 });
    const pages: string[][] = [];
    const all = await new StackedPrService(ctx).getNativeChanges(pr(1, "h"), 3, 0, (p) => pages.push(p.map((f) => f.path)));
    expect(pages).toEqual([["/b.ts"], ["/a.ts"]]);
    expect(all.map((f) => f.path)).toEqual(["/a.ts", "/b.ts"]);
    expect(fake.getPullRequestIterationChanges.mock.calls[1][5]).toBe(500);
  });

  it("follows the continuation token when listing a PR's commits", async () => {
    const first = Object.assign([{ commitId: "c1" }], { continuationToken: "next" });
    fake.getPullRequestCommits = vi.fn().mockResolvedValue(first);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ value: [{ commitId: "c2" }] }),
      headers: { get: () => null }
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const seen: number[] = [];
      const all = await new StackedPrService(ctx).getCommits("r1", 5, (_p, acc) => seen.push(acc.length));
      expect(all.map((c) => c.commitId)).toEqual(["c1", "c2"]);
      expect(seen).toEqual([1, 2]);
      expect(fetchMock.mock.calls[0][0]).toContain("continuationToken=next");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("layer diff", () => {
  it("diffs from the merge base of parent and child tips, skipping folders", async () => {
    fake.getMergeBases = vi.fn().mockResolvedValue([{ commitId: "base1" }]);
    fake.getCommitDiffs = vi.fn().mockResolvedValue({
      allChangesIncluded: true,
      changes: [
        { changeType: 1, item: { path: "/new.ts", objectId: "o1" } },
        { changeType: 2, item: { path: "/mod.ts", objectId: "o2", originalObjectId: "o0" } },
        { changeType: 16, item: { path: "/gone.ts", originalObjectId: "o9" } },
        { changeType: 2, item: { path: "/dir", isFolder: true } }
      ]
    });
    const range = await new StackedPrService(ctx).getLayerRange(pr(2, "childTip"), pr(1, "parentTip"));
    expect(fake.getMergeBases).toHaveBeenCalledWith("r1", "parentTip", "childTip", "Proj");
    expect(range.baseSha).toBe("base1");
    expect(range.files.map((f) => [f.path, f.oldObjectId, f.newObjectId])).toEqual([
      ["/gone.ts", "o9", undefined],
      ["/mod.ts", "o0", "o2"],
      ["/new.ts", undefined, "o1"]
    ]);
    const [, , , , , base, target] = fake.getCommitDiffs.mock.calls[0];
    // These are the fields the generated client turns into the baseVersion/targetVersion query parameters.
    expect(base).toEqual({ version: "base1", versionType: 2 });
    expect(target).toEqual({ version: "childTip", versionType: 2 });
  });

  it("fails clearly when there is no merge base", async () => {
    fake.getMergeBases = vi.fn().mockResolvedValue([]);
    await expect(new StackedPrService(ctx).getLayerRange(pr(2, "aaaaaaaa"), pr(1, "bbbbbbbb"))).rejects.toThrow(/No merge base/);
  });
});

describe("file content", () => {
  it("caches by commit and path, and treats 404 as an empty file", async () => {
    fake.getItemText = vi.fn().mockResolvedValueOnce("hello").mockRejectedValueOnce({ status: 404 });
    const s = new StackedPrService(ctx);
    expect(await s.getFileText("r1", "/a", "sha1")).toBe("hello");
    expect(await s.getFileText("r1", "/a", "sha1")).toBe("hello");
    expect(fake.getItemText).toHaveBeenCalledTimes(1);
    expect(await s.getFileText("r1", "/missing", "sha1")).toBe("");
  });
});

describe("review actions land on the selected PR only", () => {
  it("votes on the given PR id and repository, for the current user", async () => {
    fake.createPullRequestReviewer = vi.fn().mockResolvedValue({});
    await new StackedPrService(ctx).vote(pr(2, "h"), 10);
    expect(fake.createPullRequestReviewer).toHaveBeenCalledTimes(1);
    expect(fake.createPullRequestReviewer).toHaveBeenCalledWith({ vote: 10, id: "me" }, "r1", 2, "me", "Proj");
  });

  it("creates threads on the selected PR", async () => {
    fake.createThread = vi.fn().mockResolvedValue({});
    await new StackedPrService(ctx).createThread(pr(7, "h"), { comments: [] } as never);
    expect(fake.createThread).toHaveBeenCalledWith({ comments: [] }, "r1", 7, "Proj");
  });

  it("retargets by updating targetRefName", async () => {
    fake.updatePullRequest = vi.fn().mockResolvedValue({});
    await new StackedPrService(ctx).retarget(pr(2, "h"), "refs/heads/main");
    expect(fake.updatePullRequest).toHaveBeenCalledWith({ targetRefName: "refs/heads/main" }, "r1", 2, "Proj");
  });

  it("posts a pending gate status while the parent is open and a succeeded one afterwards", async () => {
    fake.createPullRequestStatus = vi.fn().mockResolvedValue({});
    const s = new StackedPrService(ctx);
    await s.postGateStatus(pr(2, "h"), true, 1);
    await s.postGateStatus(pr(2, "h"), false, 1);
    const states = fake.createPullRequestStatus.mock.calls.map((c) => c[0].state);
    expect(states).toEqual([1, 2]);
    expect(fake.createPullRequestStatus.mock.calls[0][0].context).toEqual({ genre: "stacked-prs", name: "parent-merged" });
  });

  it("stores and clears the manual parent as a PR property", async () => {
    fake.updatePullRequestProperties = vi.fn().mockResolvedValue({});
    const s = new StackedPrService(ctx);
    await s.setManualParent(pr(2, "h"), 1);
    await s.setManualParent(pr(2, "h"), undefined);
    expect(fake.updatePullRequestProperties.mock.calls[0][0]).toEqual([{ op: "add", path: `/${PARENT_PROPERTY}`, value: "1" }]);
    expect(fake.updatePullRequestProperties.mock.calls[1][0][0].op).toBe("remove");
  });
});
