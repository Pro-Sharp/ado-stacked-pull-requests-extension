import * as React from "react";
import { GitCommitRef, GitPullRequestIteration } from "azure-devops-extension-api/Git";
import { shortRef } from "../../core/api/mapping";
import { Avatar, ErrorBanner, MoreSentinel, Spinner, useIncremental } from "../common/components";
import { mapLimit } from "../../core/api/concurrency";
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
  // Iterations render at once from the data already in hand; their commit lists load lazily, only for the
  // iterations that are on screen (newest first, more on scroll), a few requests at a time.
  const ordered = React.useMemo(() => [...iterations].reverse(), [iterations]);
  const paging = useIncremental(ordered.length, 15, pr.id);
  const [commitsByIteration, setCommits] = React.useState(new Map<number, GitCommitRef[]>());
  const [error, setError] = React.useState<unknown>();
  const requested = React.useRef(new Set<string>());
  const visibleIds = ordered.slice(0, paging.limit).map((it) => it.id).join(",");
  React.useEffect(() => {
    let alive = true;
    const todo = ordered.slice(0, paging.limit).filter((it) => !requested.current.has(`${pr.id}:${it.id}`));
    todo.forEach((it) => requested.current.add(`${pr.id}:${it.id}`));
    mapLimit(todo, 4, async (it) => {
      try {
        const detail = await service.getIterationCommits(pr.repositoryId, pr.id, it.id);
        if (alive) setCommits((m) => new Map(m).set(it.id, detail));
      } catch {
        if (alive) setCommits((m) => new Map(m).set(it.id, it.commits ?? []));
      }
    }).catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pr.id, visibleIds]);
  const first = iterations[0];
  return (
    <div className="sp-timeline">
      <ErrorBanner error={error} />
      {ordered.slice(0, paging.limit).map((it) => {
        const retarget = it.newTargetRefName && it.oldTargetRefName && it.newTargetRefName !== it.oldTargetRefName;
        const commits = commitsByIteration.get(it.id) ?? it.commits ?? [];
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
      {paging.hasMore && <MoreSentinel onVisible={paging.more} version={paging.limit} label={`Showing ${paging.limit} of ${ordered.length} updates, scroll for more...`} />}
      {!paging.hasMore && first?.commonRefCommit && (
        <div className="sp-muted" style={{ padding: "6px 0" }}>Based on commit <span style={{ fontFamily: "Consolas, monospace" }}>{shortSha(first.commonRefCommit.commitId)}</span></div>
      )}
    </div>
  );
}

export function CommitsTab({ pr }: { pr: PrInfo }) {
  const service = useService();
  // Pages are appended as they arrive; the list is windowed so a PR with hundreds of commits stays responsive.
  const [commits, setCommits] = React.useState<GitCommitRef[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<unknown>();
  React.useEffect(() => {
    let alive = true;
    setCommits([]);
    setLoading(true);
    setError(undefined);
    service
      .getCommits(pr.repositoryId, pr.id, (_page, all) => alive && setCommits([...all]))
      .then(
        (all) => alive && (setCommits(all), setLoading(false)),
        (e) => alive && (setError(e), setLoading(false))
      );
    return () => {
      alive = false;
    };
  }, [pr.id, pr.headSha]);
  const paging = useIncremental(commits.length, 50, pr.id);
  return (
    <div>
      <ErrorBanner error={error} />
      {commits.slice(0, paging.limit).map((c) => (
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
      {paging.hasMore && <MoreSentinel onVisible={paging.more} version={paging.limit} />}
      {loading && <Spinner text={commits.length ? `Loaded ${commits.length} commits, loading more...` : "Loading..."} />}
      {!loading && !commits.length && !error && <div className="sp-muted">No commits.</div>}
    </div>
  );
}
