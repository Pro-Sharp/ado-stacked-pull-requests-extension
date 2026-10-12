import { StackedPrService, StackSnapshot } from "../core/api/services";
import { detectStacks } from "../core/stack/detect";
import { toPrInfo, RawPullRequest } from "../core/api/mapping";

/**
 * In-memory stand-in for StackedPrService used by the visual harness and by
 * screenshots in the docs. It models a three-PR stack plus unrelated PRs in two repositories.
 */
const me = { id: "me", displayName: "Ádám Kovács", imageUrl: "" };
const bc = { id: "bc", displayName: "Balázs Csiaki", imageUrl: "" };
const zn = { id: "zn", displayName: "Zsolt Nagy", imageUrl: "" };

const iso = (d: string) => new Date(d);

interface MockPr {
  pullRequestId: number;
  repository: { id: string; name: string };
  title: string;
  isDraft: boolean;
  status: number;
  sourceRefName: string;
  targetRefName: string;
  lastMergeSourceCommit: { commitId: string };
  lastMergeTargetCommit: { commitId: string };
  mergeStatus: number;
  createdBy: typeof me;
  creationDate: Date;
  description: string;
  reviewers: { id: string; displayName: string; imageUrl: string; vote: number; isRequired?: boolean }[];
  labels: { id: string; name: string }[];
}

const repo = { id: "repo-hub", name: "hubscience-systematic-review" };
const repo2 = { id: "repo-api", name: "hubscience-api" };

const prs: MockPr[] = [
  {
    pullRequestId: 10870, repository: repo, title: "Storage path scope compose", isDraft: false, status: 1,
    sourceRefName: "refs/heads/feature/61966-storage-path-scope-compose", targetRefName: "refs/heads/master",
    lastMergeSourceCommit: { commitId: "a1a1a1a1a1a1" }, lastMergeTargetCommit: { commitId: "0000aaaa0000" }, mergeStatus: 3,
    createdBy: zn, creationDate: iso("2026-10-01T09:00:00Z"), description: "Introduces the **storage scope** composition used by the search engine.",
    reviewers: [{ id: "me", displayName: me.displayName, imageUrl: "", vote: 0, isRequired: true }, { id: "bc", displayName: bc.displayName, imageUrl: "", vote: 10 }], labels: [{ id: "l1", name: "backend" }]
  },
  {
    pullRequestId: 10871, repository: repo, title: "Search engine rework: query translator", isDraft: false, status: 1,
    sourceRefName: "refs/heads/feature/search-translator", targetRefName: "refs/heads/master",
    lastMergeSourceCommit: { commitId: "b2b2b2b2b2b2" }, lastMergeTargetCommit: { commitId: "0000aaaa0000" }, mergeStatus: 3,
    createdBy: bc, creationDate: iso("2026-10-03T09:00:00Z"), description: "Builds on !10870. Adds the `FrameworkQueryTranslator`.",
    reviewers: [{ id: "me", displayName: me.displayName, imageUrl: "", vote: 5 }, { id: "zn", displayName: zn.displayName, imageUrl: "", vote: 0 }], labels: []
  },
  {
    pullRequestId: 10872, repository: repo, title: "Research: how the field builds search strategies, and what that means for ours", isDraft: true, status: 1,
    sourceRefName: "refs/heads/chore/search-strategy-research", targetRefName: "refs/heads/master",
    lastMergeSourceCommit: { commitId: "c3c3c3c3c3c3" }, lastMergeTargetCommit: { commitId: "0000aaaa0000" }, mergeStatus: 3,
    createdBy: bc, creationDate: iso("2026-09-19T08:35:00Z"),
    description: "## Summary\n\nDocumentation only. Research into how other systematic review systems get from a research question to a set of ready-made search expressions.\n\n- `docs/RESEARCH-search-strategy-construction.md` is the decision document.\n- `docs/research/` carries the four evidence documents.\n\n**Findings that change what we can build:**\n\n- Cochrane publishes nine strings, all study-design filters.\n- The paediatric filters span 58.5% to 99.5% sensitivity.",
    reviewers: [], labels: []
  },
  {
    pullRequestId: 4410, repository: repo2, title: "Add rate limiting middleware", isDraft: false, status: 1,
    sourceRefName: "refs/heads/feature/rate-limit", targetRefName: "refs/heads/main",
    lastMergeSourceCommit: { commitId: "d4d4d4d4d4d4" }, lastMergeTargetCommit: { commitId: "1111bbbb1111" }, mergeStatus: 2,
    createdBy: zn, creationDate: iso("2026-10-08T09:00:00Z"), description: "Adds a token bucket limiter.",
    reviewers: [{ id: "me", displayName: me.displayName, imageUrl: "", vote: -5 }], labels: []
  },
  {
    pullRequestId: 4411, repository: repo2, title: "Rate limiting: per-tenant quotas", isDraft: false, status: 1,
    sourceRefName: "refs/heads/feature/rate-limit-tenants", targetRefName: "refs/heads/feature/rate-limit",
    lastMergeSourceCommit: { commitId: "e5e5e5e5e5e5" }, lastMergeTargetCommit: { commitId: "d4d4d4d4d4d4" }, mergeStatus: 3,
    createdBy: zn, creationDate: iso("2026-10-09T09:00:00Z"), description: "Stacked on !4410 (targets its branch).",
    reviewers: [{ id: "bc", displayName: bc.displayName, imageUrl: "", vote: 10 }], labels: []
  }
];

const commitSets = new Map<number, Set<string>>([
  [10870, new Set(["a1a1a1a1a1a1"])],
  [10871, new Set(["a1a1a1a1a1a1", "b2b2b2b2b2b2"])],
  [10872, new Set(["a1a1a1a1a1a1", "b2b2b2b2b2b2", "c3c3c3c3c3c3"])],
  [4410, new Set(["d4d4d4d4d4d4"])],
  [4411, new Set(["e5e5e5e5e5e5"])]
]);

const FILES: Record<string, Record<string, string>> = {
  base: {
    "/docs/ROADMAP.md": "# Roadmap\n\n- Search\n- Screening\n- Export\n",
    "/src/storage.ts": "export const scope = 'global';\nexport function path(id: string) {\n  return `/data/${id}`;\n}\n"
  },
  a1a1a1a1a1a1: {
    "/docs/ROADMAP.md": "# Roadmap\n\n- Search\n- Screening\n- Export\n",
    "/src/storage.ts": "export const scope = 'project';\nexport function path(id: string) {\n  return `/data/${scope}/${id}`;\n}\nexport function compose(...parts: string[]) {\n  return parts.join('/');\n}\n"
  },
  b2b2b2b2b2b2: {
    "/docs/ROADMAP.md": "# Roadmap\n\n- Search (rework)\n- Screening\n- Export\n",
    "/src/storage.ts": "export const scope = 'project';\nexport function path(id: string) {\n  return `/data/${scope}/${id}`;\n}\nexport function compose(...parts: string[]) {\n  return parts.join('/');\n}\n",
    "/src/translator.ts": "export class FrameworkQueryTranslator {\n  translate(q: string) {\n    return q.trim();\n  }\n}\n"
  },
  c3c3c3c3c3c3: {
    "/docs/ROADMAP.md": "# Roadmap\n\n- Search (rework)\n- Screening\n- Export\n",
    "/src/storage.ts": "export const scope = 'project';\nexport function path(id: string) {\n  return `/data/${scope}/${id}`;\n}\nexport function compose(...parts: string[]) {\n  return parts.join('/');\n}\n",
    "/src/translator.ts": "export class FrameworkQueryTranslator {\n  translate(q: string) {\n    return q.trim();\n  }\n}\n",
    "/docs/RESEARCH-search-strategy-construction.md": "# Search strategy construction\n\nThis document answers three questions.\n\n1. How do Rayyan and EasySLR build search?\n2. What solutions exist?\n3. Do Cochrane publish ready-made strings?\n",
    "/docs/research/search-filter-catalogue.md": "# A Catalogue of Reusable Search Filters\n\n**Answering: are there ready-made search expressions?**\n\nShort answer: yes for study design.\n"
  }
};

type ThreadLike = Record<string, unknown>;
const threads: Record<number, ThreadLike[]> = {
  10872: [
    {
      id: 1, status: 1, isDeleted: false, publishedDate: iso("2026-10-12T15:30:00Z"), threadContext: null,
      comments: [{ id: 1, commentType: 1, content: "comments", author: me, publishedDate: iso("2026-10-12T15:30:00Z"), usersLiked: [], isDeleted: false }]
    },
    {
      id: 2, status: 1, isDeleted: false, publishedDate: iso("2026-10-12T15:40:00Z"),
      threadContext: { filePath: "/src/translator.ts", rightFileStart: { line: 3, offset: 1 }, rightFileEnd: { line: 3, offset: 20 } },
      comments: [{ id: 1, commentType: 1, content: "Should this also lower-case the query?", author: zn, publishedDate: iso("2026-10-12T15:40:00Z"), usersLiked: [], isDeleted: false }]
    },
    {
      id: 3, status: 1, isDeleted: false, publishedDate: iso("2026-10-12T15:45:00Z"),
      threadContext: { filePath: "/src/storage.ts", rightFileStart: { line: 5, offset: 1 }, rightFileEnd: { line: 5, offset: 20 } },
      comments: [{ id: 1, commentType: 1, content: "Inherited comment on a parent PR file.", author: bc, publishedDate: iso("2026-10-12T15:45:00Z"), usersLiked: [], isDeleted: false }]
    }
  ]
};

const iterations: Record<number, unknown[]> = {
  10872: [
    { id: 1, author: bc, createdDate: iso("2026-09-19T08:35:00Z"), commits: [{ commitId: "c3c3c3c3c3c3", comment: "How the field builds search strategies, and what that means for ours", author: { name: "Balázs Csiaki", date: iso("2026-09-19T08:35:00Z") } }], sourceRefCommit: { commitId: "c3c3c3c3c3c3" }, commonRefCommit: { commitId: "base" }, newTargetRefName: "refs/heads/master", oldTargetRefName: "refs/heads/master" },
    { id: 2, author: zn, createdDate: iso("2026-10-05T10:00:00Z"), commits: [], sourceRefCommit: { commitId: "c3c3c3c3c3c3" }, commonRefCommit: { commitId: "base" }, newTargetRefName: "refs/heads/feature/61966-storage-path-scope-compose", oldTargetRefName: "refs/heads/master" },
    { id: 3, author: zn, createdDate: iso("2026-10-05T10:05:00Z"), commits: [], sourceRefCommit: { commitId: "c3c3c3c3c3c3" }, commonRefCommit: { commitId: "base" }, newTargetRefName: "refs/heads/master", oldTargetRefName: "refs/heads/feature/61966-storage-path-scope-compose" }
  ]
};

const rawFor = (p: MockPr) => ({ ...p, labels: p.labels, workItems: [], completionOptions: undefined, commits: [] });
const defaultIteration = (p: MockPr) => [{ id: 1, author: p.createdBy, createdDate: p.creationDate, commits: [{ commitId: p.lastMergeSourceCommit.commitId }], sourceRefCommit: p.lastMergeSourceCommit, commonRefCommit: { commitId: "base" }, newTargetRefName: p.targetRefName, oldTargetRefName: p.targetRefName }];

const changeType = (oldT: string | undefined, newT: string | undefined) => (oldT === undefined ? 1 : newT === undefined ? 16 : 2);

function filesBetween(base: string, head: string) {
  const a = FILES[base] ?? {};
  const b = FILES[head] ?? {};
  const out: { path: string; changeType: number; changeTrackingId: number }[] = [];
  let i = 0;
  for (const path of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[path] === b[path]) continue;
    out.push({ path, changeType: changeType(a[path], b[path]), changeTrackingId: ++i });
  }
  return out;
}

export function createMockService(): StackedPrService {
  const info = prs.map((p) => toPrInfo(p as unknown as RawPullRequest));
  const forest = detectStacks(info, { commitsByPr: commitSets });
  const snapshot: StackSnapshot = {
    forest,
    prs: info,
    raw: new Map(prs.map((p) => [p.pullRequestId, rawFor(p) as never])),
    repositories: [{ id: repo.id, name: repo.name }, { id: repo2.id, name: repo2.name }] as never
  };
  const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 60));
  const noop = () => delay(undefined as never);

  const mock = {
    ctx: { projectId: "p", projectName: "HubScience", userId: "me", userName: me.displayName },
    loadStacks: () => delay(snapshot),
    getPullRequest: (_r: string, id: number) => delay(rawFor(prs.find((p) => p.pullRequestId === id)!) as never),
    getIterations: (_r: string, id: number) => delay((iterations[id] ?? defaultIteration(prs.find((p) => p.pullRequestId === id)!)) as never),
    getIterationCommits: (_r: string, id: number, it: number) => delay((((iterations[id] ?? []) as { id: number; commits: unknown[] }[]).find((i) => i.id === it)?.commits ?? []) as never),
    getCommits: (_r: string, id: number) => delay((iterations[id] ? (iterations[id] as { commits: unknown[] }[])[0].commits : []) as never),
    getThreads: (_r: string, id: number) => delay((threads[id] ?? []) as never),
    getStatuses: () => delay([] as never),
    getPolicyEvaluations: () => delay([{ evaluationId: "e1", status: 2, configuration: { type: { displayName: "Minimum number of reviewers" } }, context: {} }, { evaluationId: "e2", status: 1, configuration: { type: { displayName: "Build" } }, context: { buildDefinitionName: "CI" } }] as never),
    getWorkItemRefs: () => delay([{ id: "61966" }] as never),
    getNativeChanges: (pr: { headSha: string }) => delay(filesBetween("base", pr.headSha) as never),
    getLayerRange: (child: { headSha: string }, parent: { headSha: string }) => delay({ baseSha: parent.headSha, headSha: child.headSha, files: filesBetween(parent.headSha, child.headSha) } as never),
    getFileText: (_r: string, path: string, sha: string) => delay((FILES[sha] ?? {})[path] ?? ""),
    vote: noop, createThread: noop, addComment: noop, editComment: noop, deleteComment: noop, setThreadStatus: noop, like: noop,
    updatePullRequest: noop, retarget: noop, setManualParent: noop, postGateStatus: noop, addLabel: noop, removeLabel: noop,
    removeReviewer: noop, addReviewer: noop, requeuePolicy: noop, searchIdentities: () => delay([{ id: "x", displayName: "Alex Example" }])
  };
  return mock as unknown as StackedPrService;
}
