<!-- @format -->

# Development

## Requirements

- Node.js 20+ (tfx-cli requirement)
- An Azure DevOps organization where you can install extensions, and a [Marketplace publisher](https://marketplace.visualstudio.com/manage) for packaging

## Commands

| Command               | What it does                                                |
| --------------------- | ----------------------------------------------------------- |
| `npm test`            | Unit tests (Vitest, 70+)                                    |
| `npm run test:watch`  | Watch mode                                                  |
| `npm run typecheck`   | `tsc --noEmit`, strict                                      |
| `npm run build`       | Production webpack build into `dist/`                       |
| `npm run dev`         | webpack-dev-server on `https://localhost:3000` (hot reload) |
| `npm run package`     | Build and create `dist-vsix/*.vsix` with tfx                |
| `npm run package:dev` | Same, with the dev manifest (see below)                     |

## Visual harness (no Azure DevOps needed)

The harness renders the real UI against mock data from `src/harness/mockService.ts` (a three-PR stack in one repository, a two-PR stack in another).

```bash
npx webpack --mode development --env harness
node scripts/serve.js 5173
```

Open <http://localhost:5173/harness.html> (list) or `harness.html#/pr/repo-hub/10872/files` (PR view). Reload after rebuilding. `npm run build` wipes `dist/`, so rebuild the harness afterwards.

## Testing in a real organization

1. Set your publisher id in `azure-devops-extension.json` (`publisher`).
2. Package the dev build: `npm run package:dev`. `scripts/dev-manifest.js` applies `azure-devops-extension.dev.json`
   (a different id and `baseUri` set to `https://localhost:3000`) and rewrites the feature flag's `featureId` to the dev
   id, which tfx's `--overrides-file` cannot do because it appends contributions instead of replacing them.
3. Upload the `.vsix` as a private extension and share it with your organization (or install directly from the Marketplace management page).
4. `npm run dev` and accept the self-signed certificate once by opening <https://localhost:3000/hub.html>. The extension now loads from your machine with hot reload.
5. Debug in Firefox or browser dev tools: the extension runs inside iframes of the Azure DevOps page.

Create a stack to try it: branch `a` from `main`, `b` from `a`, open PRs `a → main` and `b → main` (and, to test the explicit case, `c → b`).

### Things to verify early in a new organization

These are the assumptions that the unit tests cannot cover:

1. A comment created from **This PR only** on an added line appears on the same line in the native PR page.
2. The **Stack** tab receives the PR in `SDK.getConfiguration()`.
3. The PR "..." menu entry appears and its context contains the PR id and repository id (the handler accepts several shapes).
4. Policy evaluations load (the Policy API is a preview endpoint) and _Queue_ re-runs a build policy.

## Publishing

```bash
npm run package
npx tfx extension publish --manifest-globs azure-devops-extension.json --token <PAT> --share-with <your-org>
```

- The PAT needs the _Marketplace → Manage_ scope.
- Bump `version` in `azure-devops-extension.json` (and `package.json`) for each release; the Marketplace rejects duplicates.
- Keep `"public": false` until you want to list it publicly.
- Adding a scope later forces every organization to re-authorize the extension, so keep the scope list in the manifest deliberate.

## Azure DevOps Server

The manifest targets Azure DevOps Server 2022 and later (`Microsoft.TeamFoundation.Server`, `[19.0,)`). To test on a
server, upload the `.vsix` from `npm run package` (or `package:dev`) under **Collection Settings → Extensions → Browse
local extensions → Manage extensions**, then install it into a collection.

Server-specific behaviour lives in `src/core/api/host.ts`:

- `collectionUrl()` asks the host's location service for the collection root, so links and raw `fetch` calls work
  under `https://server/DefaultCollection/`.
- `azure-devops-extension-api` hard-codes `7.2-preview` on every call, which older servers reject. `negotiateApiVersion`
  wraps the REST clients: when a server answers "out of range", the limit it reports is cached and the call is
  retried at that version (and at resource version 1 if needed). The cloud never sees a rewritten version.
- Raw `fetch` calls go through `apiFetch`, which applies the same negotiation.

## Feature flag

The `stacked-prs-feature` contribution (`ms.vss-web.feature`) is a native Azure DevOps preview feature, on by default
and switchable per user and per organization or collection. Every UI contribution carries a `Feature` constraint on
`{publisher}.{extension id}.stacked-prs-feature`, so when it is off the host does not load the hub, tab or action at
all. `test/manifest.test.ts` fails if a new contribution is added without the constraint.

## Project conventions

- Pure logic in `src/core` (no SDK imports) and `src/ui/list/filter.ts`; React components stay thin.
- REST access only through `StackedPrService`, so tests can mock one object.
- Keep immutable data (commit sets, file contents, merge bases) in caches keyed by sha.
- Anything that sends data to Azure DevOps takes the selected `PrInfo`, never a derived parent or child.

## Continuous integration

`.github/workflows/ci.yml` runs typecheck, tests and the production build on every push and pull request, and uploads the `.vsix` as a build artifact.
