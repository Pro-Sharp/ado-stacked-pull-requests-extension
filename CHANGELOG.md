# Changelog

## 0.2.0

- Added Azure DevOps Server 2022+ (on-prem) support: the manifest targets Server, URLs are built from the
  collection root the host reports instead of `dev.azure.com`, and REST calls drop to the highest API version
  the server accepts
- Identity search on Server also searches Active Directory
- Re-queuing a policy no longer throws when the server rejects it

## 0.1.4

- Fixed: the Stack tab on the native pull request page got narrower while loading (the iframe resize now keeps its width)
- The Stack tab now shows only the Files view, without the duplicated header, tabs and stack map

## 0.1.3

- Rewrote the README as a showcase page for the Marketplace and GitHub

## 0.1.2

- Fixed: README screenshots did not show on the Marketplace page (the images are now packaged with the extension)

## 0.1.1

- Fixed: the "This PR only" layer diff showed 0 changed files for stacked PRs (the commit-diff request was sent without its base and target commits)
- Fixed: diff colours in a light Azure DevOps theme on a dark OS (the palette now follows the host theme instead of the OS setting)
- Added a gap between the chips in the Stack column

## 0.1.0

Initial implementation.

- Stack list across all repositories of a project, with tabs (Active, Mine, Needs my review, Drafts, Completed), repository filter and search
- Stack detection: explicit (target = parent source), contained (shared commits) and manual parents; health states (in sync, parent ahead, parent merged, conflicts)
- PR review view modelled on the native page: Overview, Files, Updates, Commits
- "This PR only" layer diff and "All changes" diff, collapsible context, "Viewed" marks
- Inline comment threads (create, reply, edit, delete, like, status), comments on inherited changes grouped separately
- Votes (all five states), reviewers, tags, work items, policy evaluations and statuses, complete / auto-complete / abandon / publish
- Retarget and merge-order status helpers for stacks
- Hub page, PR tab and PR menu action contributions
- Progressive loading: pull request pages, changed-file pages and commit pages render as they arrive, long lists (stack list, files, diff lines, activity, updates, commits) use infinite scroll, and the PR view no longer waits for stack detection
