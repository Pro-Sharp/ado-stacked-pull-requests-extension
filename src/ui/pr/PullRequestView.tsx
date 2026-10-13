import * as React from "react";
import { shortRef } from "../../core/api/mapping";
import { countResolved } from "../../core/diff/threads";
import { PrInfo } from "../../core/stack/types";
import { Avatar, ErrorBanner, HealthPill, Menu, Spinner, useAsync } from "../common/components";
import { useNav, useService } from "../context";
import { CompleteDialog, VoteButton } from "./Actions";
import { DiffMode, FilesView } from "./Files";
import { Overview } from "./Overview";
import { Sidebar } from "./Sidebar";
import { StackMap } from "./StackMap";
import { CommitsTab, UpdatesTab } from "./UpdatesCommits";
import { toPrInfo, RawPullRequest } from "../../core/api/mapping";
import { detectStacks } from "../../core/stack/detect";
import { StackForest } from "../../core/stack/types";
import { GitPullRequest } from "azure-devops-extension-api/Git";

export type PrTab = "overview" | "files" | "updates" | "commits";

interface Props {
  repoId: string;
  prId: number;
  /** Rendered inside the native PR page (Stack tab): hides the back link. */
  embedded?: boolean;
  initialTab?: PrTab;
  /** Called when the user switches tabs so the host can reflect it in the URL. */
  onTabChange?: (tab: PrTab) => void;
}

export function PullRequestView({ repoId, prId, embedded, initialTab = "overview", onTabChange }: Props) {
  const service = useService();
  const nav = useNav();
  const [tab, setTabState] = React.useState<PrTab>(initialTab);
  React.useEffect(() => setTabState(initialTab), [initialTab]);
  const setTab = (t: PrTab) => {
    setTabState(t);
    onTabChange?.(t);
  };
  const [mode, setMode] = React.useState<DiffMode | undefined>();
  const [completing, setCompleting] = React.useState(false);
  const [actionError, setActionError] = React.useState<unknown>();

  // Three independent loads so the page renders as soon as the PR itself is here:
  //  - core: the PR, its iterations and comment threads (everything the tabs need),
  //  - checks: statuses, policies and linked work items (the Overview side cards),
  //  - stack: the repository-wide stack detection, by far the heaviest request and only needed for the stack map.
  const core = useAsync(async () => {
    const [raw, iterations] = await Promise.all([service.getPullRequest(repoId, prId), service.getIterations(repoId, prId)]);
    const latest = iterations[iterations.length - 1];
    const threads = await service.getThreads(repoId, prId, latest?.id);
    return { raw, iterations, threads };
  }, [repoId, prId]);
  const checks = useAsync(async () => {
    const [statuses, policies, workItems] = await Promise.all([
      service.getStatuses(repoId, prId).catch(() => []),
      service.getPolicyEvaluations(prId),
      service.getWorkItemRefs(repoId, prId).catch(() => [])
    ]);
    return { statuses, policies, workItems };
  }, [repoId, prId]);
  // Stacks are detected within the repository only; related PRs from other repos cannot stack on this one.
  const stack = useAsync(() => service.loadStacks({ repositoryIds: [repoId], completedDays: 30 }).catch(() => undefined), [repoId, prId]);

  const raw0 = core.data?.raw;
  const forest = React.useMemo<StackForest | undefined>(() => {
    const snapshot = stack.data;
    if (!snapshot || !raw0) return undefined;
    // Make sure the PR itself is in the forest even when it is a draft/new PR that the project query missed.
    if (snapshot.forest.nodes.has(prId)) return snapshot.forest;
    return detectStacks([...snapshot.prs, toPrInfo(raw0 as unknown as RawPullRequest)], { commitsByPr: new Map() });
  }, [stack.data, raw0, prId]);

  const d = core.data && { ...core.data, statuses: checks.data?.statuses ?? [], policies: checks.data?.policies ?? [], workItems: checks.data?.workItems ?? [], forest };
  /** Light refresh after comments, votes, reviewer edits: the stack cannot have changed, so it is not recomputed. */
  const reload = () => {
    core.reload();
    checks.reload();
  };
  /** Full refresh after changes that can alter the stack (status, draft, target branch, parent links). */
  const reloadAll = () => {
    reload();
    stack.reload();
  };
  const pr: PrInfo | undefined = d ? toPrInfo(d.raw as unknown as RawPullRequest) : undefined;
  const node = d?.forest?.nodes.get(prId);
  const parent = node?.parentId !== undefined ? d!.forest!.nodes.get(node.parentId)?.pr : undefined;
  const activeMode: DiffMode = mode ?? (parent ? "layer" : "all");
  const resolved = d ? countResolved(d.threads as never) : undefined;

  const guard = async (fn: () => Promise<unknown>) => {
    try {
      setActionError(undefined);
      await fn();
      reloadAll();
    } catch (e) {
      setActionError(e);
    }
  };

  if (core.loading && !d) return <div className="sp-app"><Spinner /></div>;
  if (!d || !pr) {
    return (
      <div className="sp-app">
        <ErrorBanner error={core.error ?? "Pull request not found"} />
        {!embedded && <button className="sp-btn" onClick={() => nav.openList()}>Back to list</button>}
      </div>
    );
  }
  const raw: GitPullRequest = d.raw;
  const nativeUrl = nav.nativeUrl(pr.repositoryName, pr.id);

  return (
    <div className="sp-app" style={embedded ? { padding: "8px 0" } : undefined}>
      {!embedded && (
        <div style={{ marginBottom: 8 }}>
          <a onClick={() => nav.openList()} style={{ cursor: "pointer", fontSize: 12 }}>← All stacked pull requests</a>
        </div>
      )}
      <div className="sp-pr-header">
        <div>
          <h1 className="title">{pr.title}</h1>
          <div className="meta">
            {pr.isDraft && <span className="sp-pill">Draft</span>}
            {pr.status === "completed" && <span className="sp-pill success">Completed</span>}
            {pr.status === "abandoned" && <span className="sp-pill muted">Abandoned</span>}
            <span>!{pr.id}</span>
            <Avatar name={pr.authorName} url={raw.createdBy?.imageUrl} size={20} />
            <span>
              {pr.authorName} proposes to merge <a href={`${nativeUrl}`} target="_blank" rel="noreferrer">{shortRef(pr.sourceRef)}</a> into <strong>{shortRef(pr.targetRef)}</strong>
            </span>
            {resolved && resolved.total > 0 && <span>{resolved.resolved}/{resolved.total} comments resolved</span>}
            {node && <HealthPill health={node.health} conflicts={node.hasConflicts} />}
          </div>
        </div>
        <div className="actions">
          {pr.isDraft && pr.status === "active" && (
            <button className="sp-btn primary" onClick={() => guard(() => service.updatePullRequest(pr, { isDraft: false }))}>Publish</button>
          )}
          {!pr.isDraft && <VoteButton pr={pr} raw={raw} onChanged={reload} />}
          {pr.status === "active" && !pr.isDraft && (
            <button className="sp-btn" onClick={() => setCompleting(true)}>Complete</button>
          )}
          <Menu trigger={(toggle) => <button className="sp-btn subtle" onClick={toggle} aria-label="More actions">⋮</button>}>
            {(close) => (
              <div>
                <button onClick={() => { close(); window.open(nativeUrl, "_blank"); }}>Open in Azure DevOps</button>
                <hr />
                {pr.status === "active" && !pr.isDraft && <button onClick={() => { close(); guard(() => service.updatePullRequest(pr, { isDraft: true })); }}>Mark as draft</button>}
                {pr.status === "active" && <button onClick={() => { close(); if (window.confirm("Abandon this pull request?")) guard(() => service.updatePullRequest(pr, { status: 2 })); }}>Abandon</button>}
                {pr.status === "abandoned" && <button onClick={() => { close(); guard(() => service.updatePullRequest(pr, { status: 1 })); }}>Reactivate</button>}
                {pr.status === "active" && <SetParentItems pr={pr} forest={d.forest} close={close} onDone={reloadAll} />}
                <button onClick={() => { close(); reloadAll(); }}>Refresh</button>
              </div>
            )}
          </Menu>
        </div>
      </div>

      <ErrorBanner error={actionError} />
      <div className="sp-tabs" style={{ marginTop: 10 }}>
        {([["overview", "Overview"], ["files", "Files"], ["updates", "Updates"], ["commits", "Commits"]] as [PrTab, string][]).map(([id, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {d.forest && <StackMap forest={d.forest} currentId={prId} onChanged={reloadAll} />}

      {tab === "overview" && (
        <div className="sp-pr-body">
          <Overview pr={pr} raw={raw} iterations={d.iterations} threads={d.threads} statuses={d.statuses} policies={d.policies} onChanged={reload} onEditDescription={async (text) => { await service.updatePullRequest(pr, { description: text }); reload(); }} />
          <Sidebar pr={pr} raw={raw} workItems={d.workItems as { id: string }[]} onChanged={reload} workItemUrl={nav.workItemUrl} />
        </div>
      )}
      {tab === "files" && stack.loading && mode === undefined && <Spinner text="Detecting the stack to pick the default diff..." />}
      {tab === "files" && !(stack.loading && mode === undefined) && (
        <FilesView pr={pr} parent={parent} iterations={d.iterations} threads={d.threads} mode={activeMode} onModeChange={setMode} onChanged={reload} nativeFilesUrl={`${nativeUrl}?_a=files`} />
      )}
      {tab === "updates" && <UpdatesTab pr={pr} iterations={d.iterations} />}
      {tab === "commits" && <CommitsTab pr={pr} />}

      {completing && <CompleteDialog pr={pr} raw={raw} onClose={() => setCompleting(false)} onDone={() => { setCompleting(false); reloadAll(); }} />}
    </div>
  );
}

/** "Set parent" entries for the "..." menu: pin this PR on top of another open PR in the same repository. */
function SetParentItems({ pr, forest, close, onDone }: { pr: PrInfo; forest?: StackForest; close: () => void; onDone: () => void }) {
  const service = useService();
  const candidates = [...(forest?.nodes.values() ?? [])].filter((n) => n.pr.id !== pr.id && n.pr.status === "active" && n.pr.repositoryId === pr.repositoryId);
  if (!candidates.length) return null;
  return (
    <>
      <hr />
      <div className="sp-muted" style={{ padding: "4px 14px", fontSize: 11 }}>Stack on top of...</div>
      {candidates.slice(0, 12).map((n) => (
        <button key={n.pr.id} onClick={async () => { close(); await service.setManualParent(pr, n.pr.id); onDone(); }}>
          !{n.pr.id} {n.pr.title.length > 40 ? n.pr.title.slice(0, 40) + "…" : n.pr.title}
        </button>
      ))}
    </>
  );
}
