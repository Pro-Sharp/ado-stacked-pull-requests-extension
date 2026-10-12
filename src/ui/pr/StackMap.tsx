import * as React from "react";
import { shortRef } from "../../core/api/mapping";
import { stackRows } from "../../core/stack/render";
import { StackForest, StackNode } from "../../core/stack/types";
import { HealthPill } from "../common/components";
import { useNav, useService } from "../context";
import { PrInfo } from "../../core/stack/types";

/** The chain of PRs this PR is part of, shown above the tabs like a "stack map". */
export function StackMap({ forest, currentId, onChanged }: { forest: StackForest; currentId: number; onChanged: () => void }) {
  const nav = useNav();
  const service = useService();
  const current = forest.nodes.get(currentId);
  if (!current) return null;
  const root = forest.nodes.get(current.stackRootId)!;
  if (root.childIds.length === 0 && root.pr.id === currentId) return null;

  const rows = stackRows(forest, root.pr.id);

  const parent = current.parentId !== undefined ? forest.nodes.get(current.parentId) : undefined;

  return (
    <div className="sp-card sp-stackmap">
      <div className="head">
        <strong style={{ color: "var(--sp-text)" }}>Stack</strong>
        <span>{rows.length} pull requests · target {shortRef(root.pr.targetRef)}</span>
      </div>
      {rows.map(({ node, prefix }) => (
        <div className={`node ${node.pr.id === currentId ? "current" : ""}`} key={node.pr.id}>
          <span className="guide">{prefix}</span>
          <a onClick={() => nav.openPr(node.pr.repositoryId, node.pr.id)} className="t" title={node.pr.title}>
            !{node.pr.id} {node.pr.title}
          </a>
          {node.pr.status === "completed" && <span className="sp-pill muted">Completed</span>}
          {node.pr.isDraft && <span className="sp-pill">Draft</span>}
          <HealthPill health={node.health} conflicts={node.hasConflicts} />
        </div>
      ))}
      {parent && <StackHints current={current} parent={parent} onChanged={onChanged} service={service} />}
    </div>
  );
}

function StackHints({ current, parent, onChanged, service }: { current: StackNode; parent: StackNode; onChanged: () => void; service: ReturnType<typeof useService> }) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string>();
  const pr: PrInfo = current.pr;
  const trunk = "refs/heads/" + shortRef(parent.pr.targetRef);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(undefined);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hint">
      {current.health === "parent-ahead" && (
        <div>
          The parent PR has new commits. Restack with <code>git rebase {shortRef(parent.pr.sourceRef)}</code> on <code>{shortRef(pr.sourceRef)}</code> and push.
        </div>
      )}
      {current.health === "parent-merged" && (
        <div>
          The parent PR was completed.{" "}
          {pr.targetRef !== trunk ? (
            <button className="sp-btn" disabled={busy} onClick={() => run(() => service.retarget(pr, trunk))}>
              Retarget to {shortRef(trunk)}
            </button>
          ) : (
            <>
              Rebase onto <code>{shortRef(trunk)}</code> to drop the merged commits from this PR.
            </>
          )}
        </div>
      )}
      <div style={{ marginTop: 4, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {parent.pr.status === "active" && (
          <button className="sp-btn subtle" disabled={busy} title="Adds a status that a branch policy can require, so this PR cannot be completed before its parent" onClick={() => run(() => service.postGateStatus(pr, true, parent.pr.id))}>
            Block completion until parent merges
          </button>
        )}
        {current.relation === "manual" && (
          <button className="sp-btn subtle" disabled={busy} onClick={() => run(() => service.setManualParent(pr, undefined))}>
            Remove manual parent link
          </button>
        )}
      </div>
      {err && <div className="sp-error">{err}</div>}
    </div>
  );
}
