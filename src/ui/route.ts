export type Route = { kind: "list" } | { kind: "pr"; repoId: string; prId: number; tab?: string };

/** Hash routes: `#/` (list) and `#/pr/{repoId}/{prId}[/{tab}]`. */
export function parseRoute(hash: string): Route {
  const clean = hash.replace(/^#/, "");
  const m = /^\/pr\/([^/]+)\/(\d+)(?:\/([a-z]+))?\/?$/i.exec(clean);
  if (!m) return { kind: "list" };
  return { kind: "pr", repoId: decodeURIComponent(m[1]), prId: Number(m[2]), tab: m[3] };
}

export function buildRoute(route: Route): string {
  if (route.kind === "list") return "#/";
  return `#/pr/${encodeURIComponent(route.repoId)}/${route.prId}${route.tab ? `/${route.tab}` : ""}`;
}

/**
 * Base web URL of the project from the collection root, e.g. https://dev.azure.com/org/project on the cloud
 * or https://tfs.contoso.local/DefaultCollection/project on Azure DevOps Server.
 */
export function projectBaseUrl(collectionUrl: string, project: string): string {
  return `${collectionUrl.replace(/\/+$/, "")}/${encodeURIComponent(project)}`;
}

export function nativePrUrl(base: string, repoName: string, prId: number): string {
  return `${base}/_git/${encodeURIComponent(repoName)}/pullrequest/${prId}`;
}

export function hubUrl(base: string, publisher: string, extension: string, contribution: string, route: Route): string {
  return `${base}/_apps/hub/${publisher}.${extension}.${contribution}${buildRoute(route)}`;
}
