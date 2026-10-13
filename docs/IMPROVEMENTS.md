# Future improvements

A research-backed backlog of what could make this extension stand out. It is a roadmap, not a commitment: items are
grouped by theme and ranked by expected value to reviewers and effort for us.

## How this was researched

- The Developer Community ticket for stacked pull requests
  (<https://developercommunity.visualstudio.com/t/stacked-pull-requests/365762>) renders client-side and could not be
  read by the tooling used for this research, so its vote count and comments are **not** summarised here. Open it in a
  browser and add the headline numbers below if useful.
- Searches for other Developer Community threads returned no directly quotable posts. The pain points below are
  therefore drawn from Microsoft's own documentation, release notes, third-party tools built to fill the gaps, and
  community workarounds (userscripts, bookmarklets, blog posts). Treat them as well-supported signals, not as a vote count.

## Pain points of the built-in pull request tool

| # | Pain point | Evidence |
|---|---|---|
| 1 | **No stacked / dependent PRs.** A PR can target another branch, but Azure DevOps has no PR-to-PR dependency, no stack view, no restack after a parent merges, and no ordering of completion. Teams script it or merge manually, retarget by hand and delete merged branches by hand. | [ado-stack](https://github.com/drrius/ado-stack/tree/main), [StackPilot](https://github.com/sethmansi/StackPilot), [manual walkthrough](https://medium.com/@efthymiou.dimitrios1/merge-stacked-pull-requests-to-master-using-azure-de-1289d03bd06f), [target-branch docs](https://learn.microsoft.com/en-us/azure/devops/repos/git/pull-request-targets?view=azure-devops) |
| 2 | **Large PRs are hard to review.** Summary view omits files over 0.5 MB, the diff truncates a single file over 5 MB, and reviewers are told to download and use a local diff tool. | [Review pull requests](https://learn.microsoft.com/en-us/azure/devops/repos/git/review-pull-requests) |
| 3 | **Diff ergonomics.** Wide lines force horizontal scrolling; the inline view makes before/after hard to follow for heavily changed methods, so people fall back to side-by-side across several monitors. | [Multi-screen code review](https://marcroussy.com/2019/10/15/multi-screen-azure-devops-code-review/) |
| 4 | **Review progress is weak.** "Mark as reviewed" is personal, has no progress count, and does not flag a file that changed after you reviewed it (GitHub's equivalent does). | [Sprint 159 notes](https://devblogs.microsoft.com/devops/whats-new-in-azure-devops-sprint-159), [GitHub: mark files as viewed](https://github.blog/2019-07-01-mark-files-as-viewed/) |
| 5 | **Navigating a big file tree.** Users ask for keyboard collapse, remembered expand/collapse state and highlighting of files they still need to review; a userscript and a bookmarklet exist purely to do this. | [Blog comments on the new PR experience](https://devblogs.microsoft.com/devops/introducing-the-new-pull-request-experience-for-azure-repos/comment-page-3), [More Awesome Azure DevOps](https://greasyfork.org/en/scripts/381397-azdo-pull-request-improvements) |
| 6 | **Reviewing only what changed since last time** depends on a changeset dropdown and the Updates tab; force-pushes make the Commits tab and the Updates tab disagree. | [Review pull requests](https://learn.microsoft.com/en-us/azure/devops/repos/git/review-pull-requests) |
| 7 | **Diff semantics are confusing.** PRs use a three-dot diff while branch compare uses two-dot, so the same branches look different in two places. | [Review pull requests](https://learn.microsoft.com/en-us/azure/devops/repos/git/review-pull-requests) |
| 8 | **Browser-only review.** Review lives in the web portal; there is demand for in-editor review with inline comments and apply-suggestion. | [vscode#321542](https://github.com/microsoft/vscode/issues/321542) |
| 9 | **Noisy diffs.** Formatting and import reordering bury real changes; guidance is to ask authors to clean up. | [Review pull requests](https://learn.microsoft.com/en-us/azure/devops/repos/git/review-pull-requests) |
| 10 | **Stability of newer features.** A reported React crash when using the Suggestion feature in the new experience. | [Blog comments](https://devblogs.microsoft.com/devops/introducing-the-new-pull-request-experience-for-azure-repos/comment-page-3) |

Microsoft has since added Copilot code review and suggested changes, so the gap is shrinking in those two areas. Stacked
PRs remain the clearest gap, and GitHub now ships them natively (stack map, partial merges, automatic rebasing, merge
queue support), which sets the bar users will compare against
([DevOps.com](https://devops.com/github-brings-stacked-pull-requests-out-of-the-shadows/)).

## Already covered here

Stack hierarchy across repositories, layer ("This PR only") diff, stack map, stack health, manual parent, retarget helper,
merge-order gate status, "Viewed" marks, inline threads with all statuses, votes, reviewers, tags, work items, policies,
complete / auto-complete / abandon / draft, Updates and Commits tabs, and progressive loading with infinite scroll.

## Backlog

Impact and effort are rough: S is a day or less, M a few days, L a week or more.

### Tier 1 - widen the gap on stacked PRs (our core differentiator)

| Idea | Why | Impact | Effort |
|---|---|---|---|
| **Stack-wide review dashboard**: one screen listing each layer with its reviewers, votes, unresolved comments, policy and build state, and a bottom-up "review next" order | Competing tools produce a single cross-PR summary; reviewers otherwise open each PR in turn | High | M |
| **Merge-order enforcement help**: show "blocked by parent" on the PR page and in the list, auto-post and refresh the gate status when the parent completes (today it is a manual button) | Closes the loop on pain point 1 | High | M |
| **Guided restack after a parent merges**: one click retargets the child, and a generated, copyable `git rebase --onto` command is shown with a conflict preflight | Restacking is the most painful manual step; extensions cannot run git, so produce the exact commands and verify the result | High | M |
| **Complete bottom-up**: "complete this layer and retarget the next" as a single action, with a squash-merge-aware merge base | Squash merges break naive ancestry; the layer diff already survives this | High | M |
| **Stack-aware descriptions**: optionally write a stack map block into each PR's description so it shows in the native page too | The map then travels with the PR for people without the extension | Med | S |
| **Review across the stack**: comment counts and "unresolved in stack" badge on the list and map | Reviewers can see where a stack is stuck | Med | S |

### Tier 2 - fix the diff and review ergonomics

| Idea | Why | Impact | Effort |
|---|---|---|---|
| **Side-by-side diff** with a persisted inline/side-by-side toggle | Pain point 3; most requested review ergonomics | High | M |
| **Ignore whitespace** and a "hide moved / formatting-only changes" option | Pain point 9; the diff library already supports whitespace options | High | S |
| **Syntax highlighting** and intra-line (word-level) change highlighting | Faster reading of dense changes | High | M |
| **"Changed since you viewed"** badge on files plus a review progress bar (e.g. 7/23 viewed). Viewed state is keyed by blob id today, so the detection is nearly free | Pain point 4; matches GitHub | High | S |
| **Review since last visit / between pushes**: a "Changes since my last review" shortcut and an iteration range picker built on iteration compare | Pain point 6 | High | M |
| **Large file handling**: lift the 0.5 MB and 5 MB limits by streaming and windowing; show a size warning and "load anyway" | Pain point 2 | Med | M |
| **Keyboard navigation**: next/previous file, next unresolved comment, mark viewed, collapse folder | Pain point 5 | Med | M |
| **File tree upgrades**: remember expanded folders, filter by "unviewed" or "has comments", highlight files still to review | Pain point 5; replaces the userscript | Med | S |
| **Wide-line handling**: wrap toggle or sticky horizontal scroll | Pain point 3 | Low | S |
| **Suggested changes**: lightbulb in the composer that inserts a fenced suggestion block, with apply in the thread | Native has it, so parity | Med | M |

### Tier 3 - workflow and reach

| Idea | Why | Impact | Effort |
|---|---|---|---|
| **Saved list views and inbox**: "waiting on me", "stuck > N days", "ready to merge", with a pinned view and a count in the hub title | Limited visibility of where reviews stall | High | M |
| **Reviewer load and age indicators**: PR age, time since last activity, oldest unreviewed | Same | Med | S |
| **Comment triage**: filter threads by status, author and file, "my unresolved", bulk resolve | Native filter is coarse | Med | S |
| **Explain the diff base**: label whether a view is a three-dot or two-dot diff and offer a toggle | Pain point 7 | Low | S |
| **Pre-merge checklist**: conflicts, policies, unresolved threads, parent state, one panel before Complete | Fewer failed completions | Med | S |
| **AI assist (opt-in)**: summarise a layer, suggest review order, draft descriptions. Keep it advisory and show what is sent | StackPilot and Copilot show demand | Med | L |
| **Deep links**: stable URLs to a file, line and thread inside the stacked view, openable from the native page | Sharing review context | Low | S |

### Tier 4 - quality, performance and trust

| Idea | Why | Impact | Effort |
|---|---|---|---|
| **Virtualised diff rows** instead of windowed growth | Very large files stay smooth | Med | M |
| **Cache stack detection** per repository (session storage keyed by head shas) and refresh incrementally | Open the hub instantly | High | M |
| **Replace per-PR manual-parent lookups** with a single stored map (extension data service) or a cheaper marker | Currently one request per active PR | Med | M |
| **Lazy comment counts** from a batch endpoint where available | Fewer requests on the list | Low | S |
| **Accessibility pass**: roles, focus order, contrast in dark theme, screen-reader labels | Reaches more teams | Med | M |
| **Telemetry-free diagnostics page**: show request counts, timings and the last errors | Easier support without sending data anywhere | Low | S |
| **End-to-end tests** against a disposable organisation (as ado-stack does) plus visual regression for the harness | Protects the review flows that write data | Med | L |

## Suggested order

1. Quick wins that close visible gaps: ignore whitespace, "changed since viewed" and progress bar, file tree upgrades.
2. Side-by-side diff and syntax highlighting.
3. Stack dashboard and guided restack / bottom-up completion, which are the headline differentiators.
4. Saved views and caching for the hub.
5. Everything else as demand shows up.

## Sources

- [Review and comment on pull requests - Microsoft Learn](https://learn.microsoft.com/en-us/azure/devops/repos/git/review-pull-requests)
- [Configure custom target branches for pull requests - Microsoft Learn](https://learn.microsoft.com/en-us/azure/devops/repos/git/pull-request-targets?view=azure-devops)
- [What's new in Azure DevOps Sprint 159 (mark files as reviewed)](https://devblogs.microsoft.com/devops/whats-new-in-azure-devops-sprint-159)
- [Introducing the new pull request experience for Azure Repos (comments)](https://devblogs.microsoft.com/devops/introducing-the-new-pull-request-experience-for-azure-repos/comment-page-3)
- [GitHub Brings Stacked Pull Requests Out of the Shadows - DevOps.com](https://devops.com/github-brings-stacked-pull-requests-out-of-the-shadows/)
- [GitHub: Mark files as viewed](https://github.blog/2019-07-01-mark-files-as-viewed/)
- [ado-stack: Graphite-style stacked PRs for Azure DevOps](https://github.com/drrius/ado-stack/tree/main)
- [StackPilot: AI-assisted stacked PR manager for Azure DevOps](https://github.com/sethmansi/StackPilot)
- [Merge stacked pull requests to master using Azure DevOps](https://medium.com/@efthymiou.dimitrios1/merge-stacked-pull-requests-to-master-using-azure-de-1289d03bd06f)
- [Multi screen Azure DevOps code review](https://marcroussy.com/2019/10/15/multi-screen-azure-devops-code-review/)
- [More Awesome Azure DevOps userscript](https://greasyfork.org/en/scripts/381397-azdo-pull-request-improvements)
- [Feature request: native Azure DevOps pull request support in VS Code](https://github.com/microsoft/vscode/issues/321542)
