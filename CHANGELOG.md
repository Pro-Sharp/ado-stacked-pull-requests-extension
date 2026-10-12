# Changelog

## 0.1.0 - unreleased

Initial implementation.

- Stack list across all repositories of a project, with tabs (Active, Mine, Needs my review, Drafts, Completed), repository filter and search
- Stack detection: explicit (target = parent source), contained (shared commits) and manual parents; health states (in sync, parent ahead, parent merged, conflicts)
- PR review view modelled on the native page: Overview, Files, Updates, Commits
- "This PR only" layer diff and "All changes" diff, collapsible context, "Viewed" marks
- Inline comment threads (create, reply, edit, delete, like, status), comments on inherited changes grouped separately
- Votes (all five states), reviewers, tags, work items, policy evaluations and statuses, complete / auto-complete / abandon / publish
- Retarget and merge-order status helpers for stacks
- Hub page, PR tab and PR menu action contributions
