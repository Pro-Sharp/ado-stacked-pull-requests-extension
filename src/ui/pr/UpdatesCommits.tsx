import * as React from "react";
import { GitCommitRef, GitPullRequestIteration } from "azure-devops-extension-api/Git";
import { shortRef } from "../../core/api/mapping";
import { Avatar, ErrorBanner, Spinner, useAsync } from "../common/components";
import { dateTime, shortDate, shortSha } from "../common/format";
import { useService } from "../context";
import { PrInfo } from "../../core/stack/types";

function CommitLine({ c }: { c: GitCommitRef }) {
  const first = (c.comment ?? "").split("\n")[0];
  return (
    <div style={{ padding: "8px 0" }}>
      <div>{first}</div>
      <div className="sub" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, marginTop: 3 }}>
        <span className="sha" style={{ fontFamily: "Consolas, monospace" }}>{shortSha(c.commitId)}</span>
        <Avatar name={c.author?.name} url={c.author?.imageUrl} size={16} />
        <span>{c.author?.name}</span>
        <span className="sp-muted">{dateTime(c.author?.date)}</span>
      </div>
    </div>
  );
}

/** Iterations ("updates") of the PR, newest first, like the native Updates tab. */
export function UpdatesTab({ pr, iterations }: { pr: PrInfo; iterations: GitPullRequestIteration[] }) {
  const service = useService();
  const withCommits = useAsync(
    async () => {
      const out = new Map<number, GitCommitRef[]>();
      for (const it of iterations) {
        try {
          const detail = await service.getIterationCommits(pr.repositoryId, pr.id, it.id);
          out.set(it.id, detail);
        } catch {
          out.set(it.id, it.commits ?? []);
        }
      }
      return out;
    },
    [pr.id, iterations.length]
  );
  const first = iterations[0];
  return (
    <div className="sp-timeline">
      <ErrorBanner error={withCommits.error} />
      {[...iterations].reverse().map((it) => {
        const retarget = it.newTargetRefName && it.oldTargetRefName && it.newTargetRefName !== it.oldTargetRefName;
        const commits = withCommits.data?.get(it.id) ?? [];
        return (
          <div className="entry" key={it.id}>
            <span className="marker">{it.id}</span>
            <div className="sp-card">
              <div className="sp-activity-line">
                <Avatar name={it.author?.displayName} url={it.author?.imageUrl} size={22} />
                <div className="main">
                  <div className="what">
                    {it.author?.displayName}{" "}
                    {retarget ? `changed the target branch from ${shortRef(it.oldTargetRefName)} to ${shortRef(it.newTargetRefName)}` : `pushed ${commits.length || 1} commit${(commits.length || 1) === 1 ? "" : "s"}`}
                  </div>
                  <div className="when">{shortDate(it.createdDate)}</div>
                </div>
              </div>
              {!retarget && commits.length > 0 && (
                <div style={{ padding: "0 16px 10px", borderTop: "1px solid var(--sp-border)" }}>
                  {commits.map((c) => <CommitLine key={c.commitId} c={c} />)}
                </div>
              )}
            </div>
          </div>
        );
      })}
      {first?.commonRefCommit && (
        <div className="sp-muted" style={{ padding: "6px 0" }}>Based on commit <span style={{ fontFamily: "Consolas, monospace" }}>{shortSha(first.commonRefCommit.commitId)}</span></div>
      )}
    </div>
  );
}

export function CommitsTab({ pr }: { pr: PrInfo }) {
  const service = useService();
  const commits = useAsync(() => service.getCommits(pr.repositoryId, pr.id), [pr.id, pr.headSha]);
  if (commits.loading) return <Spinner />;
  return (
    <div>
      <ErrorBanner error={commits.error} />
      {(commits.data ?? []).map((c) => (
        <div className="sp-card sp-commit" key={c.commitId}>
          <div className="msg">{(c.comment ?? "").split("\n")[0]}</div>
          <div className="sub">
            <span className="sha">{shortSha(c.commitId)}</span>
            <Avatar name={c.author?.name} url={c.author?.imageUrl} size={16} />
            <span>{c.author?.name}</span>
            <span>{dateTime(c.author?.date)}</span>
          </div>
        </div>
      ))}
      {!commits.loading && !(commits.data ?? []).length && <div className="sp-muted">No commits.</div>}
    </div>
  );
}
