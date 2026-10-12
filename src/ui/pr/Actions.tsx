import * as React from "react";
import { GitPullRequest, GitPullRequestMergeStrategy } from "azure-devops-extension-api/Git";
import { VOTE_LABELS, VOTE_VALUES, VoteKind, voteKind } from "../../core/api/mapping";
import { PrInfo } from "../../core/stack/types";
import { Menu } from "../common/components";
import { useService } from "../context";

const VOTE_ORDER: VoteKind[] = ["approved", "approved-with-suggestions", "waiting", "rejected", "none"];

/** Approve split-button. Votes always land on this PR, never on its parent or children. */
export function VoteButton({ pr, raw, onChanged }: { pr: PrInfo; raw: GitPullRequest; onChanged: () => void }) {
  const service = useService();
  const me = (raw.reviewers ?? []).find((r) => r.id === service.ctx.userId);
  const current = voteKind(me?.vote ?? 0);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string>();

  const cast = async (kind: VoteKind) => {
    setBusy(true);
    setErr(undefined);
    try {
      await service.vote(pr, VOTE_VALUES[kind]);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (pr.status !== "active") return null;
  const label = current === "none" ? "Approve" : VOTE_LABELS[current];
  return (
    <>
      <span className="sp-split">
        <button className="sp-btn primary" disabled={busy} onClick={() => cast(current === "approved" ? "none" : "approved")} title={`Vote on !${pr.id} only`}>
          {current === "approved" ? "Approved ✓" : label}
        </button>
        <Menu trigger={(toggle) => <button className="sp-btn primary" onClick={toggle} aria-label="More vote options">▾</button>}>
          {(close) => (
            <div>
              {VOTE_ORDER.map((k) => (
                <button key={k} className={current === k ? "active" : ""} onClick={() => { close(); cast(k); }}>
                  {k === "none" ? "Reset feedback" : VOTE_LABELS[k]}
                </button>
              ))}
            </div>
          )}
        </Menu>
      </span>
      {err && <span className="sp-error" style={{ margin: 0 }}>{err}</span>}
    </>
  );
}

export function CompleteDialog({ pr, raw, onClose, onDone }: { pr: PrInfo; raw: GitPullRequest; onClose: () => void; onDone: () => void }) {
  const service = useService();
  const opts = raw.completionOptions;
  const [strategy, setStrategy] = React.useState<number>(opts?.mergeStrategy ?? GitPullRequestMergeStrategy.NoFastForward);
  const [deleteSource, setDeleteSource] = React.useState(!!opts?.deleteSourceBranch);
  const [transition, setTransition] = React.useState(opts?.transitionWorkItems ?? true);
  const [message, setMessage] = React.useState(opts?.mergeCommitMessage ?? `Merged PR ${pr.id}: ${pr.title}`);
  const [autoComplete, setAutoComplete] = React.useState(false);
  const [bypass, setBypass] = React.useState(false);
  const [bypassReason, setBypassReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string>();

  const submit = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      const completionOptions = {
        mergeStrategy: strategy,
        deleteSourceBranch: deleteSource,
        transitionWorkItems: transition,
        mergeCommitMessage: message,
        bypassPolicy: bypass,
        bypassReason: bypass ? bypassReason : undefined
      };
      if (autoComplete) {
        await service.updatePullRequest(pr, { autoCompleteSetBy: { id: service.ctx.userId }, completionOptions } as never);
      } else {
        await service.updatePullRequest(pr, { status: 3, lastMergeSourceCommit: raw.lastMergeSourceCommit, completionOptions } as never);
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }} onMouseDown={onClose}>
      <div className="sp-card" style={{ width: 520, padding: 20 }} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Complete pull request">
        <h2 style={{ marginTop: 0, fontWeight: 400 }}>Complete pull request</h2>
        <div style={{ display: "grid", gap: 10 }}>
          <label>
            Merge type
            <select className="sp-input" style={{ width: "100%" }} value={strategy} onChange={(e) => setStrategy(Number(e.target.value))}>
              <option value={GitPullRequestMergeStrategy.NoFastForward}>Merge (no fast-forward)</option>
              <option value={GitPullRequestMergeStrategy.Squash}>Squash commit</option>
              <option value={GitPullRequestMergeStrategy.Rebase}>Rebase and fast-forward</option>
              <option value={GitPullRequestMergeStrategy.RebaseMerge}>Semi-linear merge</option>
            </select>
          </label>
          <label>
            Commit message
            <textarea className="sp-input" style={{ width: "100%", minHeight: 70 }} value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
          <label><input type="checkbox" checked={deleteSource} onChange={(e) => setDeleteSource(e.target.checked)} /> Delete source branch after merging</label>
          <label><input type="checkbox" checked={transition} onChange={(e) => setTransition(e.target.checked)} /> Complete associated work items after merging</label>
          <label><input type="checkbox" checked={autoComplete} onChange={(e) => setAutoComplete(e.target.checked)} /> Set auto-complete (merge when all policies pass)</label>
          {!autoComplete && (
            <>
              <label><input type="checkbox" checked={bypass} onChange={(e) => setBypass(e.target.checked)} /> Override branch policies (requires permission)</label>
              {bypass && <input className="sp-input" placeholder="Reason for bypassing policies" value={bypassReason} onChange={(e) => setBypassReason(e.target.value)} />}
            </>
          )}
        </div>
        {err && <div className="sp-error" style={{ marginTop: 10 }}>{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button className="sp-btn" onClick={onClose}>Cancel</button>
          <button className="sp-btn primary" disabled={busy || (bypass && !bypassReason.trim())} onClick={submit}>
            {autoComplete ? "Set auto-complete" : "Complete merge"}
          </button>
        </div>
      </div>
    </div>
  );
}
