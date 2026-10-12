# Stacked Pull Requests for Azure DevOps — Design & Implementation Plan

Status: original design (2026-10-12). The implementation follows it with the changes below; see [ARCHITECTURE.md](ARCHITECTURE.md) for the as-built description.

## Decisions and deviations

- **No "team" filter.** The list shows the PRs of the whole project across all repositories, with a repository filter. Stacks are detected per repository.
- **Approvals are per PR.** A vote, comment or status is always sent to the PR being reviewed, never to its parent or children. No "layer approval" semantics exist; the optional merge-order status is the only cross-PR safeguard.
- **PR tab context** is `{ pullRequestId, repositoryId }` (from `PullRequestTabExtensionConfig` in the API package).
- **No `azure-devops-ui`.** Plain React 16 + SCSS with host theme variables; custom diff renderer (no Monaco, no `react-diff-view`).
- **Diff** uses the `diff` package; layer base is the merge base of the parent and child tips.
- **SDK 4.x**, `azure-devops-extension-api` 5.x, webpack 5, TypeScript 5, Vitest.
- Milestones M0-M6 are implemented in the first version except automated verification in a real organization (see DEVELOPMENT.md); M7 (backend) is not built.


## 1. Problem

A developer branches `a` from `main`, then `b` from `a`, and opens two PRs: `a → main` and `b → main`.
The native PR page diffs each PR against the merge base with its **target** (`main`), so PR **B shows A + B**.
Today the reviewer either wades through A's changes again or waits until A merges. Azure DevOps has no notion of a stack or of dependent PRs; its PR list is also limited to one repository at a time.

## 2. Goals / non-goals

**Goals**
1. List all active PRs across all repos in the project (like *Active Pull Requests*), grouped into **stack hierarchies** (trees): `main ← A ← B ← C`, including branching stacks.
2. Open any PR in a full review view that has two diff modes:
   - **Full**: identical to native, PR source vs merge base with target.
   - **Stack layer**: only what this branch introduced on top of its parent PR.
3. Review fully from that view: comments (create/reply/resolve/like), votes, reviewers, checks/policies/builds, auto-complete, complete, abandon, draft/publish, tags, work items, commits, updates/iterations.
4. Everything is written through the **real PR APIs**. Comments and votes made in our view appear in the native PR page and vice versa. The extension stores no shadow review state that others can't see.
5. Use current tooling: `azure-devops-extension-sdk`, `azure-devops-extension-api`, `azure-devops-ui`, webpack 5, TypeScript 5, `Microsoft.VisualStudio.Services.Cloud`.

**Non-goals / hard limits** (platform constraints, not choices)
- An extension **cannot replace or modify** the native PR page or its diff viewer. Extensions run in sandboxed iframes. "Full replacement" therefore means our own complete PR view in a hub, plus a tab and a menu action inside the native PR page that lead to it.
- There is no public API for native "file viewed" checkmarks, Copilot/AI summaries, or the native keyboard shortcuts. We implement our own equivalents (see §9).
- Pure web extensions only run while someone has a page open. Fully automatic server-side behaviour (re-posting gate statuses when a parent merges, auto-retargeting) needs the optional backend in M7.

## 3. Lessons from the existing extension (mimeo Active Pull Requests)

Reuse these ideas:
- One `ms.vss-web.hub` in `ms.vss-code-web.code-hub-group`.
- `getPullRequestsByProject` with paging, which covers all repos in one call.
- `IExtensionDataService` with User scope for settings.
- A configurable column set.
- The vote-to-status mapping.

Fix or avoid:
- **Votes:** it treats `5` (approved with suggestions) the same as `10`. It also mutates a shared status object (`Object.assign(Statuses.Waiting…)`).
- **Builds:** it uses an unbounded `getBuilds` for build status, which misses older builds. We use **policy evaluations** plus **PR statuses** instead; that is what the native page shows.
- **Threads:** it makes one `getThreads` call per PR when loading the list. We load thread counts lazily or in a bounded batch.
- **Broken comment sort** (references fields that don't exist).
- **Outdated tooling:** tslint, AMD/ES5 output, `api-version/5.0` demand, and a missing `es6-promise` dependency.
- **"Team" wording** when the code is really project-scoped. We offer an optional team filter, explained in §5.3.

## 4. Architecture overview

```
┌──────────────────────────── Azure DevOps (host page) ─────────────────────────────┐
│ Repos ▸ "Stacked PRs" hub (iframe)             Native PR page                     │
│ ┌──────────────────────────────┐               ┌────────────────────────────────┐ │
│ │ StackListView  (route: /)    │               │ Tab "Stack" (pr-tabs, iframe)  │ │
│ │ PullRequestView (?pr=&repo=) │◀── deep link ─│  stack map + layer diff        │ │
│ └──────────────────────────────┘               │ "..." menu: Open stacked review│ │
│                                                └────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────┘
           │ SDK.getAccessToken() (scoped)  ·  azure-devops-extension-api clients
           ▼
  Git REST 7.1: pullrequests, iterations, iteration changes, commits, diffs/commits,
  merge bases, items/blobs, threads, reviewers, statuses, properties, labels, work items
  Policy REST: evaluations (+requeue) · Build REST · Graph/Identity (pickers, avatars)
           │
           ▼ (optional, M7)  Azure Function service-hook consumer → gate statuses, retarget
```

Layers (all in one TS/React bundle per contribution):
- `core/api`: thin typed wrappers over the SDK REST clients. Adds retry with `Retry-After` handling, in-flight de-duplication, and a commit-keyed cache.
- `core/stack`: the stack detection engine. Pure functions, unit tested.
- `core/diff`: change-list building, blob fetch, line diff, and comment-anchor mapping.
- `ui/*`: React 16 + azure-devops-ui (Formula) components.

## 5. Stack detection

### 5.1 Relationship types (highest priority wins)

| Kind | Rule | Cost |
|---|---|---|
| **Manual** | PR property `StackedPRs.ParentPullRequestId` set via our UI, using the *Pull Request Properties* API (stored on the PR, so every user sees it) | 1 call per PR (lazy) |
| **Explicit** | Same repo and `B.targetRefName == A.sourceRefName` (B targets A's branch) | none |
| **Contained** (your case: both target `main`) | Same repo and same target, and A's commits are in B's history: `A.lastMergeSourceCommit ∈ commits(B)` → *in sync*; otherwise any commit of A ∈ commits(B) → *parent moved ahead* | 1 paged `GET pullRequests/{id}/commits` per candidate PR, cached by `(prId, headSha)` |
| **Merged parent** | As *Contained*, but A is a recently **completed** PR (`status=completed`, last N days, configurable) | same |

### 5.2 Building the tree
1. Fetch active PRs for the project, paging `$top=100` (`GET _apis/git/pullrequests?searchCriteria.status=active`).
2. Group PRs by `(repositoryId, targetRefName)`. Explicit edges need no extra calls. For the contained check, only groups with 2 or more PRs need commit lists. Fetch them concurrently with a limit of 4 in parallel.
3. For each PR, candidate parents are all PRs that it contains. Choose the **closest** one: the candidate that itself contains the most other candidates (the deepest). This is a transitive reduction, so `A ⊂ A2 ⊂ B` gives `A ← A2 ← B` and not `A ← B`.
4. Tie or cycle guard: if two PRs have the same head, mark them as duplicates and order them by creation date.
5. **Node health**, shown as a badge on each node:
   - `in-sync`
   - `parent-ahead`: A has commits that B doesn't. Shows a "restack" hint with a copyable `git rebase` command.
   - `parent-merged`: shows a "retarget/rebase onto main" action.
   - `parent-abandoned`
   - `conflicts`: from `mergeStatus`.
6. Cache the graph in memory and in `sessionStorage`, keyed by the set of `(prId, headSha)`. A refresh only re-fetches commits for PRs whose head changed.

### 5.3 List view (hub home)
- **Pivots:**
  - Active stacks
  - Mine: author is me, or I'm a reviewer
  - Needs my review: I'm a reviewer with vote 0
  - My drafts
  - Recently completed stacks
- **Filters:** keyword (title, author, branch), repository (multi-select), author, reviewer, and **team**. The team filter uses the selected team's identity as the reviewer and/or its members as authors. Teams don't own repos in ADO, so this is the closest meaningful definition.
- **Tree table** (azure-devops-ui `Tree`/`Table`) with one row per PR, indented by stack depth. Columns are configurable as in the old extension:
  - Title/#id
  - Repo
  - Source → target
  - Stack health
  - Author
  - Created
  - Reviewers and votes (with all 5 vote states shown distinctly)
  - Checks summary (from policy evaluations)
  - Comments resolved/total (loaded lazily)
  - Tags
- Clicking a row opens `PullRequestView` in the same hub (`?pr=123&repo=…`, via `IHostNavigationService.setQueryParams`), so the URL is shareable.

## 6. The stacked diff ("layer" mode)

### 6.1 Which commits
For child B with parent A:
- `head = B.lastMergeSourceCommit`
- `base = mergeBase(A.headOrMergedHead, head)`, from `GET …/commits/{head}/mergebases?otherCommitId=…`

Using the merge base, rather than A's tip, keeps the diff correct when A has moved ahead (B hasn't been restacked yet) or when B has merged newer A into itself.

For a merged parent, the base is the parent's final `lastMergeSourceCommit`. This also handles the case where A was **squash-merged**: native B then still shows A's changes, while our layer view still shows only B's.

### 6.2 File list
- `GET …/diffs/commits?baseVersion=base&baseVersionType=commit&targetVersion=head&targetVersionType=commit`, paged.
- The result gives the change types (add, edit, delete, rename) and object IDs.
- **Full mode** instead uses `GET …/pullRequests/{id}/iterations/{latest}/changes?$compareTo=0`, which is exactly what native shows.
- **Updates mode** (compare iteration X with Y) uses `$compareTo=X`.

### 6.3 Line diff and rendering
- Fetch blob content lazily for each opened file, using `items?versionDescriptor…` or `blobs/{objectId}`. Cache by object ID; blobs are immutable, so the cache never needs invalidating.
- Compute the diff in a Web Worker (`diff` / jsdiff).
- **Viewer:** `react-diff-view`. It supports split and unified layouts, inline widgets for comment threads, and hunk expansion. Syntax highlighting comes from `refractor`.
- **Why not Monaco:** Monaco's DiffEditor is several MB and needs worker hosting inside the extension iframe. Its inline widgets also require fragile view-zone code. We'll revisit it only if M0 shows `react-diff-view` can't handle large files.
- Skip binary and very large files, with a "view in native" link.
- **File tree:** azure-devops-ui `Tree`, showing a change-type icon and comment count per file, plus our own "viewed" checkbox.

## 7. Comments: the critical mapping

Threads always belong to the real PR (B), so native and our view share them.

**Creating a thread** from the layer diff:
- Request: `POST …/pullRequests/{B}/threads`.
- `threadContext.filePath` is the path.
- `rightFileStart`/`rightFileEnd` are line and offset in **B's head file**.
- `pullRequestThreadContext.iterationContext = {firstComparingIteration: latest, secondComparingIteration: latest}`.
- `pullRequestThreadContext.changeTrackingId` is taken from B's latest iteration changes for that path.

**Why it lands correctly in native:** the right side of the layer diff is the same blob as native's right side, B's head in the latest iteration.

**Edge cases**
- **Left side (deleted lines):** the left side differs, because native's left side is `mergeBase(B, main)` and ours is `mergeBase(A, B)`.
  - If the same line exists in the native left blob, we anchor there; this is a text match in a ±N window.
  - Otherwise we fall back to the nearest right-side line and quote the deleted text in the comment.
- **File not in B's native change list:** possible only if B reverted A's change back to main's content. We create a file-level thread with no line range, prefixed with a note.
- **Stale view:** before posting, we re-check that B's latest iteration `sourceRefCommit == head`. If it doesn't match, we prompt the user to reload.

**Displaying threads**
- `GET …/threads?$iteration={latest}&$baseIteration=0` returns positions re-tracked to the latest iteration.
- Threads whose right line lies inside a layer hunk render inline.
- Threads on files or lines that only belong to the parent are listed under **"Comments on inherited changes (n)"**. This list is collapsed by default and has a toggle and a link to the parent PR.
- PR-level threads (with no file) appear in the Overview tab.
- **Features:**
  - Reply (`POST …/threads/{id}/comments`)
  - Edit or delete your own comments
  - Thread status: active, fixed, won't fix, closed, by design, pending
  - Likes (Comment Likes API)
  - Markdown rendering, @mentions via the identity picker, and #work-item links
  - Code suggestions: a ```` ```suggestion ```` block, which native renders and can apply
- **System threads** (vote changes, pushes, policy events) appear in the Overview activity timeline.

## 8. Review actions and status (feature parity)

| Native feature | Our implementation | API |
|---|---|---|
| Vote (approve, approve with suggestions, wait for author, reject, reset) | Vote split-button in the PR header | `PUT …/reviewers/{me}` |
| Add/remove reviewers, required/optional | Identity picker (azure-devops-ui `IdentityPickerDropdown`) | Reviewers API |
| Policies: required reviewers, build validation, comment resolution, work-item linking, status checks | "Checks" panel with a **Re-queue** button for builds | Policy Evaluations list + requeue (`PATCH _apis/policy/evaluations/{id}`) |
| Build status and logs | Status, link to the run, and failed tasks | Build API (`branchName=refs/pull/{id}/merge`) |
| External PR statuses | Listed with the checks | `GET …/statuses` |
| Merge conflicts | Banner from `mergeStatus` with a link to native conflict resolution | PR `mergeStatus` |
| Set/cancel auto-complete, complete (merge strategy, delete source branch, transition work items, bypass policy if permitted, custom message) | Complete dialog mirroring native | `PATCH pullrequests/{id}` |
| Abandon, reactivate, draft ↔ publish | Header actions | `PATCH` (`status`, `isDraft`) |
| Title, description edit (markdown), tags | Inline editors | `PATCH`, Labels API |
| Linked work items | List, add, remove | PR Work Items API (`vso.work`) |
| Commits tab | List with per-commit diff | `…/pullRequests/{id}/commits` |
| Updates (iterations) and compare | Iteration picker in the Files view | Iterations API |
| File "viewed" marks | Our own, stored per user in Extension Data, keyed by PR, path and blob ID (resets when the file changes) | `IExtensionDataService` (User scope) |
| Retarget PR | "Change target" action, also used by stack operations | `PATCH targetRefName` |
| Open in native | Always available in the header | link `/_git/{repo}/pullrequest/{id}` |

**Stack-specific review semantics**
- A vote in layer mode is still a vote on PR B as a whole. To keep that honest, the header in layer mode shows the parent's review state ("A: approved by 2 · 1 active thread"), and the vote button says **"Approve B (layer)"**.
- **Stack gate (optional per repo):** our extension posts PR status `stacked-prs/parent-merged`:
  - `pending` while the parent is open;
  - `succeeded` once the parent is completed.

  Admins add a *Status check* branch policy on `main` that requires this context. B then can't merge before A. Prior art: the *PR Dependency* Marketplace extension uses the same pattern.
- **Stack block in PR description (optional):** we keep a marker-delimited "Stack: #12 → **#13** → #14" section in each PR description. Users without the extension can then still see the hierarchy.

## 9. Contributions & manifest

```jsonc
{
  "manifestVersion": 1,
  "id": "stacked-pull-requests",
  "publisher": "<publisher>",
  "targets": [{ "id": "Microsoft.VisualStudio.Services.Cloud" }],
  "scopes": [
    "vso.code_write",            // PRs, threads, reviewers, votes, properties, retarget, complete
    "vso.code_status",           // PR statuses (stack gate)
    "vso.build_execute",         // read builds + requeue build-validation
    "vso.work",                  // linked work items
    "vso.identity", "vso.graph", // reviewer picker, avatars
    "vso.extension.data_write"   // per-user settings & "viewed" marks
  ],
  "contributions": [
    { "id": "stacked-prs-hub", "type": "ms.vss-web.hub",
      "targets": ["ms.vss-code-web.code-hub-group"],
      "properties": { "name": "Stacked PRs", "uri": "dist/hub/hub.html", "iconName": "BranchPullRequest", "order": 101 } },
    { "id": "stacked-prs-pr-tab", "type": "ms.vss-web.tab",
      "targets": ["ms.vss-code-web.pr-tabs"],
      "properties": { "name": "Stack", "uri": "dist/pr-tab/pr-tab.html" } },
    { "id": "stacked-prs-pr-action", "type": "ms.vss-web.action",
      "targets": ["ms.vss-code-web.pull-request-action-menu"],
      "properties": { "text": "Open stacked review", "uri": "dist/pr-action/pr-action.html" } }
  ]
}
```

- **PR tab context:** `SDK.getConfiguration()` provides the PR. Read both `config.pullRequest` and `config.pullRequestId`, and verify which one is present in M0.
- **PR tab content:** the stack map plus the layer diff, which is the most common need. It also has a button that opens the full review in the hub.
- **Scopes:** adding a scope later forces admins to re-authorize, so request the full set up front.
- **Rate limits:** 200 TSTU per 5 minutes per user. Honor `Retry-After`, cap concurrency, and cache everything keyed by commit SHA or object ID.

## 10. Tech stack & repo layout

- `azure-devops-extension-sdk` **4.x** (ESM). The API package's peer range stops at 4, so v5 waits until the API package supports it.
- `azure-devops-extension-api` latest, using `GitRestClient`, `PolicyRestClient`, `BuildRestClient`, `WorkItemTrackingRestClient`, `CoreRestClient`, and `GraphRestClient`.
- `azure-devops-ui` 2.x. Its React peer is ^16.8, so we pin **React 16.14**.
- TypeScript 5 (strict), webpack 5 with one entry per contribution, sass, ESLint and Prettier.
- `diff`, `react-diff-view`, `refractor`, `marked` + `dompurify`.
- **Tests:** Vitest for `core/*` (stack engine, anchor mapping, diff building) using recorded API fixtures; Playwright smoke tests against a dev org.
- **Tooling:** `tfx-cli` 0.24 (Node 20+). The dev manifest uses `baseUri: https://localhost:3000` with webpack-dev-server for hot reload (pattern from `microsoft/azure-devops-extension-hot-reload-and-debug`). There are separate dev and prod manifests, as the mimeo repo does, but without `--rev-version` editing committed files: the version comes from `package.json`.

```
/src
  /core/api        clients, retry/cache, paging helpers
  /core/stack      detectStacks(), health(), types
  /core/diff       changeList(), lineDiff.worker.ts, anchors.ts
  /ui/common       VoteButton, ReviewerList, ChecksPanel, Markdown, IdentityPicker
  /ui/list         StackListView, StackTreeTable, filters, settings panel
  /ui/pr           PullRequestView: Overview | Files | Commits | Updates tabs, DiffViewer, ThreadWidget, CompleteDialog
  /entries         hub.tsx, pr-tab.tsx, pr-action.tsx
/static            html shells, icons
/test              fixtures, unit tests
azure-devops-extension.json, azure-devops-extension.dev.json
```

## 11. Delivery plan

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M0: Spikes** (≈3 days) | Scaffold. Hub and PR tab "hello" contributions installed in a dev org. Read the PR-tab config. **Comment-anchor proof:** from a layer diff A→B, post a right-side line comment to B and confirm it renders on the right line in the native PR. Test the left-side fallback. Render a 3,000-line diff with `react-diff-view` in the iframe. | All three risks resolved or a workaround chosen |
| **M1: Stack list** | Project-wide PR fetch, stack engine (explicit, contained, merged parent, manual), tree table, filters, pivots, settings | Example `a→main`, `b(from a)→main` shows `main ← A ← B`; unit tests cover the cases in §5 |
| **M2: PR view, read-only** | Overview (description, reviewers, checks, statuses, work items, activity), Files with Full, Layer and Updates modes, Commits | Layer mode for B shows only B's files and lines; Full mode matches native |
| **M3: Comments** | Inline threads, create, reply, edit, resolve, like, inherited-comments section, PR-level comments | Comments round-trip with the native page in both directions |
| **M4: Review actions** | Vote, reviewers, re-queue, auto-complete, complete, abandon, draft/publish, title/description/tags, work-item linking, viewed marks | Every row of the §8 table is done |
| **M5: Stack operations** | Set or clear parent manually, stack-gate status, retarget after parent merge, restack hints, stack block in description, PR-tab "Stack" view, "..." menu action | A full stack (3 PRs) can be reviewed and merged in order without leaving the extension (except conflict resolution) |
| **M6: Hardening & publish** | Caching, rate-limit handling, large-PR paging (> 2000 changes), dark theme, accessibility, error states, telemetry-free docs, private Marketplace publish and share | Used by the team for one sprint |
| **M7: Optional backend** | Azure Function consuming service hooks (`git.pullrequest.updated` / `merged`): updates gate statuses, retargets children, comments restack instructions | Gate status is correct without anyone having the page open |

## 12. Risks & open questions

1. **Comment anchoring** (§7) is my strongest inference but not a documented guarantee. M0 must prove it before anything else is built.
2. **PR-tab context shape** on the current PR page. The fallback is `pullRequestId` plus a fetch.
3. **Contained detection cost** on repos with many concurrent PRs to the same target. Mitigations: the grouping, the head-SHA cache, and lazy evaluation per repo.
4. **Squash merge** workflows leave children with stale history. We show a hint and a retarget action, and the backend in M7 can automate it.
5. **Team definition:** confirm what "team" should mean for filtering (reviewer team, member authors, or a configured repo list).
6. **Policy semantics:** should a layer-mode approval count toward B's minimum-reviewer policy? Natively it always does. If the org wants approval of the *whole* change, the stack gate (B can't merge before A) is the safeguard.
