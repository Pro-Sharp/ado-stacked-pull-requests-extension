import * as React from "react";
import { GitPullRequest, GitPullRequestCommentThread, GitPullRequestIteration, GitPullRequestStatus } from "azure-devops-extension-api/Git";
import { PolicyEvaluationRecord } from "azure-devops-extension-api/Policy";
import { shortRef } from "../../core/api/mapping";
import { isResolved, isSystemThread } from "../../core/diff/threads";
import { PrInfo } from "../../core/stack/types";
import { Avatar, Markdown, MoreSentinel, useIncremental } from "../common/components";
import { shortDate, shortSha, timeAgo } from "../common/format";
import { useService } from "../context";
import { Composer, ThreadView } from "./Threads";

interface Props {
  pr: PrInfo;
  raw: GitPullRequest;
  iterations: GitPullRequestIteration[];
  threads: GitPullRequestCommentThread[];
  statuses: GitPullRequestStatus[];
  policies: PolicyEvaluationRecord[];
  onChanged: () => void;
  onEditDescription: (text: string) => Promise<void>;
}

const POLICY_STATE: Record<number, { dot: string; label: string }> = {
  0: { dot: "pending", label: "Queued" },
  1: { dot: "pending", label: "Running" },
  2: { dot: "", label: "Succeeded" },
  3: { dot: "fail", label: "Failed" },
  4: { dot: "pending", label: "Not applicable" },
  5: { dot: "fail", label: "Broken" }
};

const STATUS_STATE: Record<number, { dot: string; label: string }> = {
  0: { dot: "pending", label: "Not set" },
  1: { dot: "pending", label: "Pending" },
  2: { dot: "", label: "Succeeded" },
  3: { dot: "fail", label: "Failed" },
  4: { dot: "fail", label: "Error" },
  5: { dot: "pending", label: "Not applicable" }
};

export function Overview({ pr, raw, iterations, threads, statuses, policies, onChanged, onEditDescription }: Props) {
  const service = useService();
  const [editing, setEditing] = React.useState(false);
  const [showAll, setShowAll] = React.useState(true);
  const real = threads.filter((t) => !t.isDeleted && !isSystemThread(t));
  const unresolved = real.filter((t) => !isResolved(t)).length;

  // Activity feed: comment threads and iteration events, newest first, with iteration markers like the native page.
  const entries: { at: number; node: React.ReactNode; marker?: number }[] = [];
  for (const t of real) {
    entries.push({ at: new Date(t.publishedDate ?? t.comments?.[0]?.publishedDate ?? 0).getTime(), node: <ThreadView key={`t${t.id}`} pr={pr} thread={t} onChanged={onChanged} /> });
  }
  iterations.forEach((it, idx) => {
    const retarget = it.newTargetRefName && it.oldTargetRefName && it.newTargetRefName !== it.oldTargetRefName;
    entries.push({
      at: new Date(it.createdDate).getTime(),
      marker: it.id,
      node: (
        <div className="sp-card sp-activity-line" key={`i${it.id}`}>
          <Avatar name={it.author?.displayName} url={it.author?.imageUrl} size={22} />
          <div className="main">
            <div className="what">
              {it.author?.displayName}{" "}
              {retarget
                ? `changed the target branch from ${shortRef(it.oldTargetRefName)} to ${shortRef(it.newTargetRefName)}`
                : `pushed ${it.commits?.length || 1} commit${(it.commits?.length || 1) === 1 ? "" : "s"}`}
            </div>
            <div className="when">{shortDate(it.createdDate)}</div>
          </div>
        </div>
      )
    });
  });
  entries.sort((a, b) => b.at - a.at);
  const feed = showAll ? entries : entries.filter((e) => e.marker === undefined);
  // The activity feed is windowed: the newest entries render first and older ones are added on scroll.
  const paging = useIncremental(feed.length, 25, `${pr.id}|${showAll}`);

  const completedPolicies = policies.filter((p) => p.status === 2).length;

  return (
    <div>
      <div className="sp-card sp-status-card" style={{ marginBottom: 14 }}>
        {pr.isDraft && (
          <div className="item">
            <span className="dot pending" />
            <div>No reviewers notified in draft mode</div>
          </div>
        )}
        {unresolved > 0 && (
          <div className="item">
            <span className="dot warn">!</span>
            <div>{unresolved} comment{unresolved === 1 ? "" : "s"} must be resolved</div>
          </div>
        )}
        <div className="item">
          <span className={`dot ${pr.mergeStatus === "conflicts" ? "fail" : pr.mergeStatus === "succeeded" ? "" : "pending"}`}>
            {pr.mergeStatus === "conflicts" ? "✕" : pr.mergeStatus === "succeeded" ? "✓" : ""}
          </span>
          <div>
            <div>{pr.mergeStatus === "conflicts" ? "Merge conflicts" : pr.mergeStatus === "succeeded" ? "No merge conflicts" : "Checking for merge conflicts"}</div>
          </div>
        </div>
        {policies.length > 0 && (
          <div className="item">
            <span className={`dot ${completedPolicies === policies.length ? "" : "pending"}`}>{completedPolicies === policies.length ? "✓" : ""}</span>
            <div>{completedPolicies}/{policies.length} policies passed</div>
          </div>
        )}
      </div>

      {(policies.length > 0 || statuses.length > 0) && (
        <div className="sp-card sp-checks" style={{ marginBottom: 14 }}>
          <h2 className="sp-section-title">Checks</h2>
          {policies.map((p) => {
            const s = POLICY_STATE[p.status] ?? POLICY_STATE[0];
            const name = (p.configuration?.type as { displayName?: string })?.displayName ?? "Policy";
            const buildName = (p.context as { buildDefinitionName?: string } | undefined)?.buildDefinitionName;
            return (
              <div className="check" key={p.evaluationId}>
                <span className={`dot ${s.dot}`} />
                <div className="name">{buildName ? `${name}: ${buildName}` : name}<div className="sp-muted" style={{ fontSize: 11 }}>{s.label}</div></div>
                {(p.status === 3 || p.status === 5 || p.status === 2) && (
                  <button className="sp-btn subtle" onClick={async () => { await service.requeuePolicy(p.evaluationId); onChanged(); }}>Queue</button>
                )}
              </div>
            );
          })}
          {statuses.map((s) => {
            const st = STATUS_STATE[s.state as number] ?? STATUS_STATE[0];
            return (
              <div className="check" key={`${s.context?.genre}/${s.context?.name}`}>
                <span className={`dot ${st.dot}`} />
                <div className="name">{s.context?.genre ? `${s.context.genre}/` : ""}{s.context?.name}<div className="sp-muted" style={{ fontSize: 11 }}>{s.description || st.label}</div></div>
                {s.targetUrl && <a href={s.targetUrl} target="_blank" rel="noreferrer">Details</a>}
              </div>
            );
          })}
        </div>
      )}

      <div className="sp-card" style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 className="sp-section-title">Description</h2>
          {pr.status === "active" && <button className="sp-btn subtle" style={{ marginRight: 12 }} onClick={() => setEditing((e) => !e)}>{editing ? "Cancel" : "Edit"}</button>}
        </div>
        {editing ? (
          <div style={{ padding: "0 16px 16px" }}>
            <Composer autoFocus initial={raw.description ?? ""} submitLabel="Save" onCancel={() => setEditing(false)} onSubmit={async (t) => { await onEditDescription(t); setEditing(false); }} />
          </div>
        ) : raw.description ? (
          <Markdown text={raw.description} />
        ) : (
          <div className="sp-muted" style={{ padding: "0 16px 16px" }}>No description provided.</div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <button className="sp-btn" onClick={() => setShowAll((s) => !s)}>
          {showAll ? `Show everything (${entries.length})` : `Comments only (${feed.length})`} ▾
        </button>
      </div>

      <div className="sp-timeline">
        <div className="entry">
          <div className="sp-card sp-compose">
            <Composer placeholder="Add a comment..." onSubmit={async (text) => {
              await service.createThread(pr, { comments: [{ parentCommentId: 0, content: text, commentType: 1 }], status: 1 } as never);
              onChanged();
            }} />
          </div>
        </div>
        {feed.slice(0, paging.limit).map((e, i) => (
          <div className="entry" key={i}>
            {e.marker !== undefined && <span className="marker">{e.marker}</span>}
            {e.node}
          </div>
        ))}
        {paging.hasMore ? (
          <MoreSentinel onVisible={paging.more} version={paging.limit} label={`Showing ${paging.limit} of ${feed.length} activities, scroll for more...`} />
        ) : (
          <div className="sp-activity-line" style={{ paddingLeft: 0 }}>
            <Avatar name={pr.authorName} url={raw.createdBy?.imageUrl} size={22} />
            <div className="main">{pr.authorName} created the pull request</div>
            <div className="when">{shortDate(pr.creationDate)}</div>
          </div>
        )}
      </div>
      <div className="sp-muted" style={{ fontSize: 11, marginTop: 8 }}>
        Source tip {shortSha(pr.headSha)} · created {timeAgo(pr.creationDate)}
      </div>
    </div>
  );
}
