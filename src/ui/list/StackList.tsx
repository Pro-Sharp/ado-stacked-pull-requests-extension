import * as React from "react";
import { GitPullRequest } from "azure-devops-extension-api/Git";
import { shortRef } from "../../core/api/mapping";
import { StackSnapshot } from "../../core/api/services";
import { stackCount, filterForest, ListTab, tabCounts } from "./filter";
import { Avatar, ErrorBanner, HealthPill, Menu, MoreSentinel, Reviewers, Spinner, useAsync, useIncremental } from "../common/components";
import { timeAgo } from "../common/format";
import { useNav, useService } from "../context";
import { mapLimit } from "../../core/api/concurrency";
import { countResolved } from "../../core/diff/threads";

const STORAGE_KEY = "stacked-prs.list";

interface Prefs {
  tab: ListTab;
  stackedOnly: boolean;
  completedDays: number;
  repositoryIds: string[];
}

function loadPrefs(): Prefs {
  try {
    return { tab: "active", stackedOnly: false, completedDays: 0, repositoryIds: [], ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") };
  } catch {
    return { tab: "active", stackedOnly: false, completedDays: 0, repositoryIds: [] };
  }
}

const TABS: { id: ListTab; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "mine", label: "Mine" },
  { id: "review", label: "Needs my review" },
  { id: "drafts", label: "Drafts" },
  { id: "completed", label: "Completed" }
];

export function StackList() {
  const service = useService();
  const nav = useNav();
  const [prefs, setPrefs] = React.useState<Prefs>(loadPrefs);
  const [search, setSearch] = React.useState("");
  const [progress, setProgress] = React.useState<[number, number]>([0, 0]);

  const update = (patch: Partial<Prefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* storage may be blocked in the iframe */
      }
      return next;
    });

  // Rows are shown from provisional snapshots while pages and commit lookups are still arriving.
  const [partial, setPartial] = React.useState<StackSnapshot>();
  const generation = React.useRef(0);
  const snapshot = useAsync<StackSnapshot>(
    () => {
      const mine = ++generation.current;
      const current = () => mine === generation.current;
      setPartial(undefined);
      setProgress([0, 0]);
      return service.loadStacks({
        repositoryIds: prefs.repositoryIds,
        completedDays: prefs.tab === "completed" && !prefs.completedDays ? 30 : prefs.completedDays,
        onProgress: (d, t) => current() && setProgress([d, t]),
        onPartial: (s) => current() && setPartial(s),
        cancelled: () => !current()
      });
    },
    [prefs.repositoryIds.join(","), prefs.completedDays, prefs.tab === "completed"]
  );

  const snap = snapshot.loading ? partial ?? snapshot.data : snapshot.data;
  const reviewersOf = React.useCallback(
    (id: number) => (snap?.raw.get(id)?.reviewers ?? []).map((r) => ({ id: r.id, vote: r.vote })),
    [snap]
  );
  const base = { search, repositoryIds: prefs.repositoryIds, stackedOnly: prefs.stackedOnly, userId: service.ctx.userId };
  const rows = React.useMemo(() => (snap ? filterForest(snap.forest, { ...base, tab: prefs.tab }, reviewersOf) : []), [snap, search, prefs]);
  const counts = React.useMemo(() => (snap ? tabCounts(snap.forest, base, reviewersOf) : undefined), [snap, search, prefs.stackedOnly, prefs.repositoryIds]);

  // Infinite scroll: only the first rows are rendered; more are added as the end of the table nears the viewport.
  const paging = useIncremental(rows.length, 50, `${prefs.tab}|${search}|${prefs.stackedOnly}|${prefs.repositoryIds.join(",")}`);
  const visibleRows = rows.slice(0, paging.limit);
  const resolved = useCommentCounts(visibleRows.filter((r) => r.matched && r.node.pr.status === "active").map((r) => r.node.pr));

  return (
    <div className="sp-app">
      <div className="sp-toolbar">
        <h1>Stacked pull requests</h1>
        <input className="sp-input" placeholder="Filter by title, author, branch..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 280 }} />
        <RepoPicker snap={snap} selected={prefs.repositoryIds} onChange={(repositoryIds) => update({ repositoryIds })} />
        <label>
          <input type="checkbox" checked={prefs.stackedOnly} onChange={(e) => update({ stackedOnly: e.target.checked })} /> Stacked only
        </label>
        <label>
          <input type="checkbox" checked={prefs.completedDays > 0} onChange={(e) => update({ completedDays: e.target.checked ? 14 : 0 })} /> Anchor on PRs completed in the last 14 days
        </label>
        <span className="grow" />
        {snap && <span className="sp-muted">{stackCount(snap.forest)} stacks · {snap.prs.length} PRs</span>}
        <button className="sp-btn" onClick={() => snapshot.reload()}>
          Refresh
        </button>
      </div>

      <div className="sp-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={prefs.tab === t.id ? "active" : ""} onClick={() => update({ tab: t.id })}>
            {t.label}
            {counts && <span className="count">{counts[t.id]}</span>}
          </button>
        ))}
      </div>

      <ErrorBanner error={snapshot.error} />
      {snapshot.loading && <Spinner text={snap ? (progress[1] ? `Detecting stacks (${progress[0]}/${progress[1]})...` : `Loaded ${snap.prs.length} pull requests, loading more...`) : "Loading pull requests..."} />}

      {snap && (
        <div className="sp-card">
          <table className="sp-table">
            <thead>
              <tr>
                <th style={{ width: "42%" }}>Pull request</th>
                <th>Branches</th>
                <th>Stack</th>
                <th>Author</th>
                <th>Created</th>
                <th>Reviewers</th>
                <th>Comments</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !snapshot.loading && (
                <tr>
                  <td colSpan={7} className="sp-muted" style={{ textAlign: "center", padding: 36 }}>
                    No pull requests match.
                  </td>
                </tr>
              )}
              {visibleRows.map(({ node, matched }) => {
                const raw = snap.raw.get(node.pr.id) as GitPullRequest | undefined;
                const pr = node.pr;
                const c = resolved.get(pr.id);
                return (
                  <tr className="row" key={pr.id} style={{ opacity: matched && pr.status === "active" ? 1 : 0.6 }}>
                    <td>
                      <div className="tree-cell" style={{ paddingLeft: node.depth * 22 }}>
                        {node.depth > 0 && <span className="guide">└</span>}
                        <div>
                          <a className="title" onClick={() => nav.openPr(pr.repositoryId, pr.id)}>
                            {pr.title}
                          </a>
                          {pr.isDraft && <span className="sp-pill" style={{ marginLeft: 8 }}>Draft</span>}
                          {pr.status === "completed" && <span className="sp-pill muted" style={{ marginLeft: 8 }}>Completed</span>}
                          <div className="sub">
                            !{pr.id} · {pr.repositoryName}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="sub">
                      {shortRef(pr.sourceRef)} → {shortRef(pr.targetRef)}
                    </td>
                    <td>
                      <HealthPill health={node.health} conflicts={node.hasConflicts} />
                      {node.childIds.length > 0 && <span className="sp-pill muted" title="Pull requests stacked on this one">{node.childIds.length} stacked</span>}
                    </td>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <Avatar name={pr.authorName} url={raw?.createdBy?.imageUrl} />
                        {pr.authorName}
                      </span>
                    </td>
                    <td className="sub">{timeAgo(pr.creationDate)}</td>
                    <td>
                      <Reviewers reviewers={(raw?.reviewers ?? []).map((r) => ({ id: r.id, displayName: r.displayName, imageUrl: r.imageUrl, vote: r.vote }))} />
                    </td>
                    <td className="sub">{c ? `${c.resolved}/${c.total}` : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {paging.hasMore && <MoreSentinel onVisible={paging.more} version={paging.limit} />}
        </div>
      )}
    </div>
  );
}

function RepoPicker({ snap, selected, onChange }: { snap?: StackSnapshot; selected: string[]; onChange: (ids: string[]) => void }) {
  const repos = snap?.repositories ?? [];
  const label = selected.length === 0 ? "All repositories" : selected.length === 1 ? repos.find((r) => r.id === selected[0])?.name ?? "1 repository" : `${selected.length} repositories`;
  return (
    <Menu trigger={(toggle) => <button className="sp-btn" onClick={toggle}>{label} ▾</button>}>
      {() => (
        <div style={{ maxHeight: 320, overflow: "auto" }}>
          <button onClick={() => onChange([])} className={selected.length === 0 ? "active" : ""}>
            All repositories
          </button>
          <hr />
          {repos.map((r) => (
            <button key={r.id} onClick={() => onChange(selected.includes(r.id) ? selected.filter((x) => x !== r.id) : [...selected, r.id])}>
              <input type="checkbox" readOnly checked={selected.includes(r.id)} /> {r.name}
            </button>
          ))}
        </div>
      )}
    </Menu>
  );
}

/** Lazily loads resolved/total comment counts for the rendered PRs (bounded concurrency, each PR requested once). */
function useCommentCounts(prs: { id: number; repositoryId: string }[]): Map<number, { resolved: number; total: number }> {
  const service = useService();
  const [counts, setCounts] = React.useState(new Map<number, { resolved: number; total: number }>());
  const requested = React.useRef(new Set<number>());
  const mounted = React.useRef(true);
  React.useEffect(() => () => void (mounted.current = false), []);
  const key = prs.map((p) => p.id).join(",");
  React.useEffect(() => {
    const todo = prs.filter((p) => !requested.current.has(p.id));
    if (!todo.length) return;
    todo.forEach((p) => requested.current.add(p.id));
    mapLimit(todo, 4, async (p) => {
      try {
        const threads = await service.getThreads(p.repositoryId, p.id);
        if (mounted.current) setCounts((m) => new Map(m).set(p.id, countResolved(threads as never)));
      } catch {
        requested.current.delete(p.id); // counts are best-effort; allow a later retry
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return counts;
}
