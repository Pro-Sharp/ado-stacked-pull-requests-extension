// @vitest-environment jsdom
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { detectStacks } from "../src/core/stack/detect";
import { PrInfo } from "../src/core/stack/types";
import { Avatar, HealthPill, Markdown, Reviewers } from "../src/ui/common/components";
import { NavContext, ServiceContext } from "../src/ui/context";
import { StackMap } from "../src/ui/pr/StackMap";

describe("common components", () => {
  it("sanitises markdown (no script or inline handlers)", () => {
    const html = renderToStaticMarkup(<Markdown text={'**hi** <script>alert(1)</script> <img src=x onerror="alert(2)">'} />);
    expect(html).toContain("<strong>hi</strong>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
  });

  it("renders health pills and conflicts", () => {
    const html = renderToStaticMarkup(<HealthPill health="parent-ahead" conflicts />);
    expect(html).toContain("Parent ahead");
    expect(html).toContain("Conflicts");
    expect(renderToStaticMarkup(<HealthPill health="root" />)).toBe("");
  });

  it("shows a vote badge per reviewer, distinguishing the five states", () => {
    const html = renderToStaticMarkup(
      <Reviewers reviewers={[{ id: "1", displayName: "A", vote: 10 }, { id: "2", displayName: "B", vote: 5 }, { id: "3", displayName: "C", vote: -5 }, { id: "4", displayName: "D", vote: -10 }, { id: "5", displayName: "E", vote: 0 }]} />
    );
    expect(html).toContain("badge approved");
    expect(html).toContain("badge suggest");
    expect(html).toContain("badge waiting");
    expect(html).toContain("badge rejected");
    expect((html.match(/class="badge/g) ?? []).length).toBe(4);
  });

  it("falls back to initials without an avatar url", () => {
    expect(renderToStaticMarkup(<Avatar name="Zsolt Nagy" />)).toContain("ZN");
  });
});

describe("StackMap", () => {
  const mk = (id: number, head: string): PrInfo => ({
    id, repositoryId: "r", repositoryName: "Repo", title: `Title ${id}`, isDraft: false, status: "active",
    sourceRef: `refs/heads/b${id}`, targetRef: "refs/heads/main", headSha: head, creationDate: new Date(2026, 0, id)
  });
  const prs = [mk(1, "a"), mk(2, "b"), mk(3, "c")];
  const forest = detectStacks(prs, { commitsByPr: new Map([[1, new Set(["a"])], [2, new Set(["a", "b"])], [3, new Set(["a", "b", "c"])]]) });
  const nav = { openPr() {}, openList() {}, nativeUrl: () => "", workItemUrl: () => "" };
  const render = (id: number) =>
    renderToStaticMarkup(
      <ServiceContext.Provider value={{ ctx: { userId: "me" } } as never}>
        <NavContext.Provider value={nav}>
          <StackMap forest={forest} currentId={id} onChanged={() => {}} />
        </NavContext.Provider>
      </ServiceContext.Provider>
    );

  it("lists the whole stack and marks the current PR", () => {
    const html = render(2);
    expect(html).toContain("3 pull requests");
    expect(html).toContain("!1 Title 1");
    expect(html).toContain("!3 Title 3");
    expect(html).toMatch(/node current[^>]*>[^]*!2 Title 2/);
  });

  it("renders nothing for a PR that is not stacked", () => {
    const lone = detectStacks([mk(9, "z")], { commitsByPr: new Map() });
    const html = renderToStaticMarkup(
      <ServiceContext.Provider value={{ ctx: { userId: "me" } } as never}>
        <NavContext.Provider value={nav}>
          <StackMap forest={lone} currentId={9} onChanged={() => {}} />
        </NavContext.Provider>
      </ServiceContext.Provider>
    );
    expect(html).toBe("");
  });
});
