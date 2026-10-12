import * as React from "react";
import { GitPullRequest } from "azure-devops-extension-api/Git";
import { voteKind, voteLabel } from "../../core/api/mapping";
import { PrInfo } from "../../core/stack/types";
import { Avatar, Menu } from "../common/components";
import { useService } from "../context";

const MARK: Record<string, string> = { approved: "✓", "approved-with-suggestions": "✓", waiting: "…", rejected: "✕", none: "" };

export function Sidebar({ pr, raw, workItems, onChanged, workItemUrl }: {
  pr: PrInfo;
  raw: GitPullRequest;
  workItems: { id: string }[];
  onChanged: () => void;
  workItemUrl: (id: string) => string;
}) {
  const service = useService();
  const [err, setErr] = React.useState<string>();
  const guard = async (fn: () => Promise<unknown>) => {
    try {
      setErr(undefined);
      await fn();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const required = (raw.reviewers ?? []).filter((r) => r.isRequired);
  const optional = (raw.reviewers ?? []).filter((r) => !r.isRequired);
  const open = pr.status === "active";

  const person = (r: GitPullRequest["reviewers"][number]) => (
    <div className="person" key={r.id}>
      <Avatar name={r.displayName} url={r.imageUrl} size={24} />
      <span className="name" title={r.displayName}>{r.displayName}</span>
      <span title={voteLabel(r.vote)} className="sp-muted">{MARK[voteKind(r.vote)]} {voteKind(r.vote) === "none" ? "" : voteLabel(r.vote)}</span>
      {open && (
        <button className="sp-btn subtle" title="Remove reviewer" onClick={() => guard(() => service.removeReviewer(pr, r.id))}>
          ✕
        </button>
      )}
    </div>
  );

  return (
    <div className="sp-side">
      {err && <div className="sp-error">{err}</div>}
      <div className="block">
        <div className="head">
          <h3>Reviewers</h3>
          {open && <AddReviewer pr={pr} onAdded={onChanged} existing={(raw.reviewers ?? []).map((r) => r.id)} />}
        </div>
        <div className="group-title">Required</div>
        {required.length ? required.map(person) : <div className="empty">No required reviewers</div>}
        <div className="group-title">Optional</div>
        {optional.length ? optional.map(person) : <div className="empty">No optional reviewers</div>}
      </div>

      <div className="block">
        <div className="head">
          <h3>Tags</h3>
          {open && <AddTag pr={pr} onAdded={onChanged} />}
        </div>
        {(raw.labels ?? []).length ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {raw.labels.map((l) => (
              <span className="sp-pill" key={l.id ?? l.name}>
                {l.name}
                {open && <a style={{ cursor: "pointer" }} title="Remove tag" onClick={() => guard(() => service.removeLabel(pr, l.name))}>✕</a>}
              </span>
            ))}
          </div>
        ) : (
          <div className="empty">No tags</div>
        )}
      </div>

      <div className="block">
        <div className="head">
          <h3>Work items</h3>
        </div>
        {workItems.length ? (
          workItems.map((w) => (
            <div className="person" key={w.id}>
              <a href={workItemUrl(w.id)} target="_blank" rel="noreferrer">#{w.id}</a>
            </div>
          ))
        ) : (
          <div className="empty">No work items</div>
        )}
      </div>
    </div>
  );
}

function AddReviewer({ pr, existing, onAdded }: { pr: PrInfo; existing: string[]; onAdded: () => void }) {
  const service = useService();
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<{ id: string; displayName: string; mail?: string }[]>([]);
  const [required, setRequired] = React.useState(false);
  const [err, setErr] = React.useState<string>();
  React.useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      service.searchIdentities(q).then((r) => alive && setResults(r.filter((i) => !existing.includes(i.id))), (e) => alive && setErr(String(e.message ?? e)));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);
  return (
    <Menu trigger={(toggle) => <button className="sp-btn" onClick={toggle}>Add ▾</button>}>
      {(close) => (
        <div style={{ padding: 8 }}>
          <input className="sp-input" autoFocus placeholder="Search users or groups" style={{ width: "100%" }} value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="sp-muted" style={{ display: "block", margin: "6px 0", fontSize: 12 }}>
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required
          </label>
          {err && <div className="sp-error">{err}</div>}
          {results.map((r) => (
            <button
              key={r.id}
              onClick={async () => {
                try {
                  await service.addReviewer(pr, r.id, required);
                  close();
                  onAdded();
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              <Avatar name={r.displayName} size={20} /> {r.displayName}
            </button>
          ))}
        </div>
      )}
    </Menu>
  );
}

function AddTag({ pr, onAdded }: { pr: PrInfo; onAdded: () => void }) {
  const service = useService();
  const [name, setName] = React.useState("");
  const [err, setErr] = React.useState<string>();
  return (
    <Menu trigger={(toggle) => <button className="sp-btn" onClick={toggle} title="Add tag">+</button>}>
      {(close) => (
        <div style={{ padding: 8 }}>
          <input
            className="sp-input"
            autoFocus
            placeholder="Tag name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key !== "Enter" || !name.trim()) return;
              try {
                await service.addLabel(pr, name.trim());
                setName("");
                close();
                onAdded();
              } catch (ex) {
                setErr(ex instanceof Error ? ex.message : String(ex));
              }
            }}
          />
          {err && <div className="sp-error">{err}</div>}
        </div>
      )}
    </Menu>
  );
}
