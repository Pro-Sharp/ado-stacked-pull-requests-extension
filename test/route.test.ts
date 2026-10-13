import { describe, expect, it } from "vitest";
import { buildRoute, hubUrl, nativePrUrl, parseRoute, projectBaseUrl } from "../src/ui/route";

describe("routes", () => {
  it("parses list and PR routes", () => {
    expect(parseRoute("")).toEqual({ kind: "list" });
    expect(parseRoute("#/")).toEqual({ kind: "list" });
    expect(parseRoute("#/pr/abc-123/42")).toEqual({ kind: "pr", repoId: "abc-123", prId: 42, tab: undefined });
    expect(parseRoute("#/pr/abc/42/files")).toEqual({ kind: "pr", repoId: "abc", prId: 42, tab: "files" });
    expect(parseRoute("#/pr/abc/notanumber")).toEqual({ kind: "list" });
  });

  it("round-trips", () => {
    const r = { kind: "pr" as const, repoId: "a b", prId: 7, tab: "files" };
    expect(parseRoute(buildRoute(r))).toEqual(r);
    expect(buildRoute({ kind: "list" })).toBe("#/");
  });

  it("builds URLs", () => {
    const base = projectBaseUrl("https://dev.azure.com/my%20org/", "My Project");
    expect(base).toBe("https://dev.azure.com/my%20org/My%20Project");
    expect(projectBaseUrl("https://tfs.contoso.local/DefaultCollection", "P")).toBe("https://tfs.contoso.local/DefaultCollection/P");
    expect(nativePrUrl(base, "Repo 1", 5)).toBe(`${base}/_git/Repo%201/pullrequest/5`);
    expect(hubUrl(base, "pub", "ext", "hub", { kind: "pr", repoId: "r", prId: 5 })).toBe(`${base}/_apps/hub/pub.ext.hub#/pr/r/5`);
  });
});
