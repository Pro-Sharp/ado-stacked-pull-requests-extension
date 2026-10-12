# Architecture

## Overview

```
Azure DevOps (host page)
 ├─ Repos ▸ "Stacked PRs" hub  (dist/hub.html)        → StackList / PullRequestView, hash routing
 ├─ Native PR page ▸ "Stack" tab (dist/pr-tab.html)    → PullRequestView (embedded)
 └─ PR "..." menu ▸ action     (dist/pr-action.html)   → navigates to the hub

each iframe:  SDK.init → StackedPrService → React UI
                          │
          Git REST 7.1 + Policy REST (via azure-devops-extension-api, token from SDK.getAccessToken)
```

There is no backend. All state lives in Azure DevOps (PRs, threads, votes, PR properties, statuses) or in the browser (`localStorage` for list preferences and "Viewed" marks).

## Source layout

| Path | Responsibility |
|---|---|
| `src/core/stack` | **Stack engine** (pure). `detectStacks` builds a forest from PRs plus per-PR commit sets; `stackRows` lays it out as a tree. |
| `src/core/diff` | **Diff and comments** (pure). `buildDiffRows`, `anchorForRow` (maps layer-diff rows onto native positions), `buildThreadPayload`, thread bucketing. |
| `src/core/api` | **REST layer.** `StackedPrService` wraps the SDK clients; `mapping` converts REST shapes; `concurrency` has `mapLimit`, `AsyncCache`, `withRetry`. |
| `src/ui` | React 16 components: `list/` (stack list, filters), `pr/` (Overview, Files, Updates, Commits, Sidebar, StackMap, Threads, Actions), `common/`. |
| `src/entries` | One bundle per contribution plus `boot.tsx` (SDK handshake, theming, providers). |
| `src/harness` | Mock-data harness (not shipped). |

The pure modules do not import the SDK, which keeps them fast to test.

## Stack detection

Input: the project's active PRs (plus recently completed ones), and for PRs that share a repository and target branch with another PR, the commit ids of each PR (`GET pullRequests/{id}/commits`, cached by `repo:pr:headSha`).

For each PR (the child), candidate parents are, in priority order:

1. A **manual** parent from the PR property `StackedPRs.ParentPullRequestId`.
2. **Explicit**: a PR in the same repository whose source branch is this PR's target branch.
3. **Contained**: a PR with the same repository and target whose commits are in the child:
   - the parent's tip is in the child's commit list → *in sync*;
   - tips differ but the commit sets overlap, and the parent is older → *parent ahead* (the parent has moved on since the child branched).

Ranking: explicit before inferred, then in-sync before parent-ahead (partial overlap also matches *sibling* PRs, so it is the weaker signal), then the candidate with the most commits (deepest in the chain). That is a transitive reduction: `A ⊂ A2 ⊂ B` gives `A ← A2 ← B`.

Cycles (possible with manual parents) are broken by dropping the edge that closes them. A completed parent yields *parent merged* for its children, which covers squash merges where the child still contains the parent's commits.

Cost: only PRs that share a (repo, target) group with another PR need commit lists, fetched with concurrency 4. Manual-parent properties are read with concurrency 6.

## Layer diff

For child B with parent A:

- `head` = tip of B's latest iteration (`sourceRefCommit`).
- `base` = `GET commits/{A.head}/mergebases?otherCommitId={head}`.
- Files: `GET diffs/commits` (base → head), paged.
- Contents: `items?versionDescriptor.version={sha}` per side, cached by repo + sha + path (immutable).
- Line diff: [`diff`](https://www.npmjs.com/package/diff) `diffLines`, with context collapsing.

Using the merge base (instead of A's tip) keeps the diff right when A has new commits, when B merged A in, and when A was squash-merged. If B targets A's branch directly, native and layer diff coincide.

## Comment anchoring

All threads belong to the real PR (B). A new thread from the layer diff is:

```
POST pullRequests/{B}/threads
  threadContext.filePath, rightFileStart/rightFileEnd = line in B's tip file
  pullRequestThreadContext.changeTrackingId         = from B's latest iteration changes
  pullRequestThreadContext.iterationContext         = {latest, latest}
```

The right side of the layer diff is the same blob as the native right side (B's tip in its latest iteration), so these comments show on the same line natively.

Fallbacks (`src/core/diff/anchors.ts`, `threadPayload.ts`):

- **Deleted line**: look for the same text in the native left file (merge base with the target) within ±25 lines; else attach to the next right-side line and prepend a quote.
- **File not in B's native change list** (no `changeTrackingId`): post a PR-level thread that names `path:line`.
- **Stale view**: before posting, the latest iteration's source commit must equal the commit that was diffed; otherwise an error asks the user to refresh.

Reading threads: `getThreads(repo, pr, iteration = latest)` returns positions re-tracked to the latest iteration. Threads on files outside the layer go to "Comments on inherited changes"; threads whose line is collapsed show at file level.

## Review actions and the "selected PR only" rule

`StackedPrService` methods for votes, comments, reviewers, completion and status always take the `PrInfo` being viewed and send its `repositoryId` and `id`. Nothing walks the hierarchy. `test/services.test.ts` asserts this.

## Contributions and manifest

See `azure-devops-extension.json`:

| Contribution | Type | Target |
|---|---|---|
| `stacked-prs-hub` | `ms.vss-web.hub` | `ms.vss-code-web.code-hub-group` |
| `stacked-prs-pr-tab` | `ms.vss-web.tab` | `ms.vss-code-web.pr-tabs` |
| `stacked-prs-pr-action` | `ms.vss-web.action` | `ms.vss-code-web.pull-request-action-menu` |

The PR tab receives `{ pullRequestId, repositoryId }` from `SDK.getConfiguration()`.

## Rate limits and caching

Azure DevOps allows about 200 TSTUs per user per 5 minutes. Mitigations: limited concurrency, commit-keyed caches (commit sets, file contents, merge bases), `withRetry` for 429/5xx, lazy comment-count loading in the list (max 60 PRs, 4 at a time), and only the PRs that need it fetch commits.

## UI choices

The UI uses plain React 16 and SCSS with the host's theme variables (`SDK.init({ applyTheme: true })`) instead of `azure-devops-ui`, which has no diff, tree-with-guides or stack components and pins React 16 anyway. The look follows the native "card on grey" layout. Dark mode follows the host theme variables and `prefers-color-scheme`.
