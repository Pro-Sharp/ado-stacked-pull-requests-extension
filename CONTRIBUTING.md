# Contributing

Thanks for helping! Bug reports, ideas and pull requests are welcome.

## Getting started

```bash
npm install
npm test
npm run typecheck
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the dev loop (mock harness, hot reload in a real organization) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the code is organized.

## Guidelines

- **Keep logic out of components.** Stack detection, diff building, comment anchoring and filtering are pure functions under `src/core` and `src/ui/list/filter.ts`. Add tests next to the behavior you change (`test/`).
- **Tests must pass**: `npm test` and `npm run typecheck`.
- **Review actions only ever touch the selected PR.** A vote, comment or status for PR B must never be sent to PR A, whatever the hierarchy. There are tests for this in `test/services.test.ts`; keep them green.
- **Small, meaningful commits** with a message that says why, not just what.
- Follow the existing style: TypeScript strict, 2-space indent, no unused code.

## Reporting bugs

Include the Azure DevOps scenario (target branches, whether the PRs are in the same repository), what you expected, and what happened. A screenshot of the stack map helps a lot.
