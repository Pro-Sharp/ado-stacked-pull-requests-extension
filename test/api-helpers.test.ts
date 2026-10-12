import { describe, expect, it, vi } from "vitest";
import { AsyncCache, mapLimit, withRetry } from "../src/core/api/concurrency";
import { reviewSummary, shortRef, toPrInfo, voteKind, voteLabel } from "../src/core/api/mapping";
import { buildDiffRows } from "../src/core/diff/lineDiff";
import { bucketThreads, countResolved, isResolved, isSystemThread, placeThreads } from "../src/core/diff/threads";

describe("toPrInfo", () => {
  it("maps REST enums and nested commits", () => {
    const pr = toPrInfo({
      pullRequestId: 7,
      repository: { id: "r", name: "Repo" },
      title: "T",
      isDraft: true,
      status: 1,
      sourceRefName: "refs/heads/a",
      targetRefName: "refs/heads/main",
      lastMergeSourceCommit: { commitId: "abc" },
      lastMergeTargetCommit: { commitId: "def" },
      mergeStatus: 2,
      createdBy: { id: "u", displayName: "Ann" },
      creationDate: "2026-01-02T00:00:00Z"
    });
    expect(pr).toMatchObject({ id: 7, status: "active", isDraft: true, headSha: "abc", targetSha: "def", mergeStatus: "conflicts" });
    expect(pr.creationDate.getUTCDate()).toBe(2);
  });

  it("shortens refs", () => {
    expect(shortRef("refs/heads/feature/x")).toBe("feature/x");
  });
});

describe("votes", () => {
  it("distinguishes all five vote states", () => {
    expect(voteKind(10)).toBe("approved");
    expect(voteKind(5)).toBe("approved-with-suggestions");
    expect(voteKind(0)).toBe("none");
    expect(voteKind(-5)).toBe("waiting");
    expect(voteKind(-10)).toBe("rejected");
    expect(voteLabel(5)).toBe("Approved with suggestions");
  });

  it("summarises reviewers and flags blocking required reviewers", () => {
    const s = reviewSummary([
      { vote: 10 },
      { vote: 5 },
      { vote: -5, isRequired: true },
      { vote: 0 }
    ]);
    expect(s).toEqual({ approved: 2, waiting: 1, rejected: 0, pending: 1, blockedByRequired: true });
    expect(reviewSummary([{ vote: 10, isRequired: true }]).blockedByRequired).toBe(false);
  });
});

describe("concurrency helpers", () => {
  it("mapLimit preserves order and respects the limit", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("AsyncCache de-duplicates and forgets failures", async () => {
    const cache = new AsyncCache<number>();
    const load = vi.fn().mockResolvedValue(1);
    await Promise.all([cache.get("k", load), cache.get("k", load)]);
    expect(load).toHaveBeenCalledTimes(1);
    await expect(cache.get("bad", () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(cache.has("bad")).toBe(false);
  });

  it("withRetry retries 429 then succeeds, and gives up on 404", async () => {
    const fn = vi.fn().mockRejectedValueOnce({ status: 429, retryAfterMs: 1 }).mockResolvedValue("ok");
    await expect(withRetry(fn, 3, 1)).resolves.toBe("ok");
    const notFound = vi.fn().mockRejectedValue({ status: 404 });
    await expect(withRetry(notFound, 3, 1)).rejects.toEqual({ status: 404 });
    expect(notFound).toHaveBeenCalledTimes(1);
  });
});

describe("thread helpers", () => {
  const th = (id: number, path: string | undefined, line: number | undefined, status = 1, system = false) => ({
    id,
    status,
    threadContext: path ? { filePath: path, rightFileStart: line ? { line } : undefined } : null,
    comments: [{ commentType: system ? 3 : 1 }]
  });

  it("detects resolved and system threads", () => {
    expect(isResolved(th(1, "/a", 1, 4))).toBe(true);
    expect(isResolved(th(1, "/a", 1, 1))).toBe(false);
    expect(isSystemThread(th(1, undefined, undefined, 1, true))).toBe(true);
  });

  it("places threads on visible rows and falls back to file level", () => {
    const { rows } = buildDiffRows("a\nb\n", "a\nB\n", -1);
    const placed = placeThreads([th(1, "/f", 2), th(2, "/f", 99), th(3, "/f", undefined)], rows);
    expect(placed.inline.get(2)!.map((t) => t.id)).toEqual([1]);
    expect(placed.fileLevel.map((t) => t.id)).toEqual([2, 3]);
  });

  it("buckets threads into layer, inherited and general", () => {
    const b = bucketThreads(
      [th(1, "/layer", 1), th(2, "/parent-only", 1), th(3, undefined, undefined), th(4, undefined, undefined, 1, true)],
      new Set(["/layer"])
    );
    expect(b.byFile.get("/layer")!.map((t) => t.id)).toEqual([1]);
    expect(b.inherited.map((t) => t.id)).toEqual([2]);
    expect(b.general.map((t) => t.id)).toEqual([3]);
  });

  it("counts resolved threads ignoring system ones", () => {
    expect(countResolved([th(1, "/a", 1, 1), th(2, "/a", 1, 2), th(3, undefined, undefined, 1, true)])).toEqual({ resolved: 1, total: 2 });
  });
});
