# User guide

## The Pull Requests (Stacked) page

Open **Repos → Pull Requests (Stacked)** in your project.

- **Hierarchy.** Pull requests are shown as a tree. A PR that sits on top of another is indented under it. PRs from every repository appear in the same list; each repository's stacks are detected separately.
- **Tabs.** *Active*, *Mine* (you are the author or a reviewer), *Needs my review* (you are a reviewer and have not voted), *Drafts*, *Completed*.
- **Filters.** Free-text search (title, author, branch, repository, `!id`), a repository picker, and **Stacked only** to hide PRs that are not part of a stack.
- **Anchor on completed PRs.** When a parent was completed in the last 14 days, its children still show *Parent merged* so you know to retarget them.
- **Stack column.** *In sync*, *Parent ahead*, *Parent merged*, *Parent abandoned*, *Conflicts*, and "N stacked" on PRs that have children.

Your tab, filters and repository selection are remembered in the browser.

## Turning it on or off

Everything the extension adds sits behind the **Stacked Pull Requests** preview feature, which is on by default:
the hub, the Stack tab on pull requests and the "Open stacked review" action. To hide them, open your user menu
(top right) → **Preview features** and switch it off.

- **For yourself**: keep the dropdown on your own name.
- **For everyone**: organization or collection administrators can pick the organization (or collection on Azure
  DevOps Server) in the dropdown and set it there. Each user can still override the organization setting.

## Reviewing a PR

Click a PR title. The layout follows the native page:

### Stack map
Above the tabs, the stack map shows the whole chain with the current PR highlighted. Click any entry to jump to it. Depending on the situation it offers:

- *Parent ahead*: the git command to restack your branch.
- *Parent merged*: **Retarget to main** (changes the PR's target branch, like the native "change target" action).
- **Block completion until parent merges**: posts a `stacked-prs/parent-merged` status on the PR. Add a *Status check* branch policy requiring that status (genre `stacked-prs`, name `parent-merged`) to make it block.

### Overview
Merge-conflict and policy status, checks (with *Queue* to re-run a build), description (editable), the activity feed (pushes, target changes, comments) and the comment box. The sidebar has reviewers, tags and linked work items.

### Files
- **This PR only** shows the changes introduced on top of the parent PR: from the merge base of both branches to this PR's tip. **All changes** is the native view (against the PR's target).
- The file tree shows change letters (A/M/D/R) and comment counts; click a file to focus it. Use **Viewed** to collapse files you finished (remembered per file version).
- Hover a line number and click **+** to start a thread. Press Ctrl+Enter to post.
- **Comments on inherited changes** lists comments on files that belong to the parent PR, so they don't clutter this layer.
- Unchanged code is collapsed; click **Show N hidden lines** to expand.

### Updates and Commits
*Updates* lists every iteration (pushes and target-branch changes). *Commits* lists the PR's commits.

## Voting and approvals

Use the button in the header. **Votes apply to the selected PR only.** If you approve PR B, PR A is not approved. The menu offers *Approved*, *Approved with suggestions*, *Waiting for the author*, *Rejected* and *Reset feedback*.

## Completing

**Complete** opens a dialog with the merge type (merge, squash, rebase, semi-linear), commit message, *delete source branch*, *complete work items*, *auto-complete* and, if you have the permission, *override policies*. For a stack, complete the bottom PR first, then use **Retarget** on the next one.

## Comments on removed lines

The "This PR only" diff compares against the parent, while the native page compares against the target branch. Comments on added or unchanged lines appear on exactly the same line in both views. For a **removed** line the extension looks for the same text in the native left side; if it cannot be found, the comment is attached to the nearest remaining line and starts with a quote of the removed text.

## Setting a parent manually

If detection cannot see a relationship (for example the PRs were rebased independently), open the PR's **⋮** menu → **Stack on top of…** and choose the parent. **Remove manual parent link** in the stack map undoes it.

## Tips

- Use the **Stack** tab on the native PR page for a quick look without leaving it; **Open stacked review** in the PR "..." menu opens the full page.
- To squash-merge a stack: complete the bottom PR, click **Retarget** on the next one, rebase it onto the trunk to drop the squashed commits, and continue.
