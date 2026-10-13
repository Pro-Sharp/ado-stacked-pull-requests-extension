import * as React from "react";
import { GitPullRequestCommentThread, GitPullRequestIteration } from "azure-devops-extension-api/Git";
import { LayerFile } from "../../core/api/services";
import { anchorForRow } from "../../core/diff/anchors";
import { buildDiffRows, DiffRow, expandGap } from "../../core/diff/lineDiff";
import { bucketThreads, placeThreads } from "../../core/diff/threads";
import { buildThreadPayload, fallbackComment } from "../../core/diff/threadPayload";
import { PrInfo } from "../../core/stack/types";
import { ErrorBanner, MoreSentinel, Spinner, useAsync, useIncremental } from "../common/components";
import { dirName, fileName } from "../common/format";
import { useService } from "../context";
import { buildTree, changeLetter, flattenTree } from "./tree";
import { Composer, ThreadView } from "./Threads";

export type DiffMode = "layer" | "all";

interface Props {
  pr: PrInfo;
  /** Parent PR in the stack, if any; enables the stack-layer mode. */
  parent?: PrInfo;
  iterations: GitPullRequestIteration[];
  threads: GitPullRequestCommentThread[];
  mode: DiffMode;
  onModeChange: (m: DiffMode) => void;
  onChanged: () => void;
  nativeFilesUrl: string;
}

type FileEntry = LayerFile & { changeTrackingId?: number };

interface FileSet {
  files: FileEntry[];
  baseSha: string;
  headSha: string;
  /** Commit the native view uses as its left side; used to anchor comments on deleted lines. */
  nativeBaseSha: string;
}

const MAX_ROWS = 4000;
const ROW_STEP = 400;

export function FilesView({ pr, parent, iterations, threads, mode, onModeChange, onChanged, nativeFilesUrl }: Props) {
  const service = useService();
  const latest = iterations[iterations.length - 1];
  const headSha = latest?.sourceRefCommit?.commitId ?? pr.headSha;

  // The file list streams in page by page: the tree and the first diffs render while later pages are still loading.
  const [fileSet, setFileSet] = React.useState<{ data?: FileSet; loading: boolean; error?: unknown }>({ loading: true });
  React.useEffect(() => {
    let alive = true;
    setFileSet({ loading: true });
    if (!latest) {
      setFileSet({ data: { files: [], baseSha: "", headSha, nativeBaseSha: "" }, loading: false });
      return;
    }
    const nativeBase = latest.commonRefCommit?.commitId ?? "";
    const show = (files: FileEntry[], baseSha: string, loading: boolean) =>
      alive && setFileSet({ data: { files: [...files].sort((a, b) => a.path.localeCompare(b.path)), baseSha, headSha, nativeBaseSha: nativeBase }, loading });
    (async () => {
      try {
        if (mode === "layer" && parent) {
          // Tracking ids are only needed when commenting, so the native listing runs alongside the layer diff.
          const nativeAll = service.getNativeChanges(pr, latest.id);
          nativeAll.catch(() => undefined);
          const soFar: FileEntry[] = [];
          const range = await service.getLayerRange({ ...pr, headSha }, parent, (base, page) => {
            soFar.push(...page);
            show(soFar, base, true);
          });
          show(range.files, range.baseSha, true);
          const tracking = new Map((await nativeAll).map((f) => [f.path, f.changeTrackingId]));
          show(range.files.map((f) => ({ ...f, changeTrackingId: tracking.get(f.path) })), range.baseSha, false);
        } else {
          const soFar: FileEntry[] = [];
          const all = await service.getNativeChanges(pr, latest.id, 0, (page) => {
            soFar.push(...page);
            show(soFar, nativeBase, true);
          });
          show(all, nativeBase, false);
        }
      } catch (error) {
        if (alive) setFileSet((s) => ({ ...s, error, loading: false }));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pr.id, headSha, mode, parent?.id]);

  const [selected, setSelected] = React.useState<string>();
  const [collapsed, setCollapsed] = React.useState(new Set<string>());
  const [filter, setFilter] = React.useState("");
  const [showInherited, setShowInherited] = React.useState(false);

  const files = React.useMemo(() => (fileSet.data?.files ?? []).filter((f) => f.path.toLowerCase().includes(filter.toLowerCase())), [fileSet.data, filter]);
  const buckets = React.useMemo(() => bucketThreads(threads, new Set((fileSet.data?.files ?? []).map((f) => f.path))), [threads, fileSet.data]);
  const tree = React.useMemo(() => flattenTree(buildTree(files), collapsed), [files, collapsed]);
  const shown = selected ? files.filter((f) => f.path === selected) : files;
  // Infinite scroll over the diffs: only the first files are mounted (and fetch their content); more follow on scroll.
  const paging = useIncremental(shown.length, 8, `${selected}|${filter}|${mode}|${parent?.id}|${pr.id}`);

  return (
    <div>
      <div className="sp-filebar">
        {parent ? (
          <span className="sp-segment" role="group" aria-label="Diff mode">
            <button className={mode === "layer" ? "active" : ""} onClick={() => onModeChange("layer")} title={`Only the changes introduced on top of !${parent.id}`}>
              This PR only
            </button>
            <button className={mode === "all" ? "active" : ""} onClick={() => onModeChange("all")} title="Everything against the target branch, like the native view">
              All changes
            </button>
          </span>
        ) : (
          <span className="sp-segment">
            <button className="active">All changes</button>
          </span>
        )}
        <input className="sp-input" placeholder="Filter files" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="count">{files.length} changed files</span>
        {mode === "layer" && parent && (
          <span className="sp-muted" style={{ fontSize: 12 }}>
            Showing changes since !{parent.id} ({fileSet.data?.baseSha.slice(0, 8)}..{headSha.slice(0, 8)})
          </span>
        )}
        <span style={{ flex: 1 }} />
        <a href={nativeFilesUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
          Open in Azure DevOps
        </a>
      </div>

      <ErrorBanner error={fileSet.error} />
      {fileSet.loading && <Spinner text={fileSet.data?.files.length ? `Loaded ${fileSet.data.files.length} changed files, loading more...` : "Loading..."} />}

      {fileSet.data && (
        <div className="sp-files">
          <div className="tree" role="tree">
            <div className={`node ${!selected ? "sel" : ""}`} onClick={() => setSelected(undefined)}>
              <strong>{pr.repositoryName}</strong>
            </div>
            {tree.map(({ node, depth }) => {
              const isFile = !!node.file;
              const count = isFile ? (buckets.byFile.get(node.path)?.length ?? 0) : 0;
              return (
                <div
                  key={node.path}
                  role="treeitem"
                  className={`node ${selected === node.path ? "sel" : ""}`}
                  style={{ paddingLeft: 8 + depth * 14 }}
                  onClick={() => {
                    if (isFile) setSelected(node.path);
                    else setCollapsed((c) => { const n = new Set(c); n.has(node.path) ? n.delete(node.path) : n.add(node.path); return n; });
                  }}
                >
                  {isFile ? <span className={`ct ${changeLetter(node.file!.changeType)}`}>{changeLetter(node.file!.changeType)}</span> : <span className="ct">{collapsed.has(node.path) ? "▸" : "▾"}</span>}
                  <span>{node.name}</span>
                  {count > 0 && <span className="cnt">💬 {count}</span>}
                </div>
              );
            })}
          </div>

          <div className="viewer">
            {mode === "layer" && buckets.inherited.length > 0 && (
              <div className="sp-card sp-inherited">
                <div className="head" onClick={() => setShowInherited((s) => !s)}>
                  {showInherited ? "▾" : "▸"} Comments on inherited changes ({buckets.inherited.length})
                  <span className="sp-muted" style={{ fontWeight: 400 }}> - on files that belong to the parent PR</span>
                </div>
                {showInherited && buckets.inherited.map((t) => <ThreadView key={t.id} pr={pr} thread={t} onChanged={onChanged} />)}
              </div>
            )}
            {shown.length === 0 && <div className="sp-muted" style={{ padding: 30, textAlign: "center" }}>No changes in this view.</div>}
            {shown.slice(0, paging.limit).map((f) => (
              <DiffFile
                key={`${f.path}:${fileSet.data!.baseSha}:${fileSet.data!.headSha}`}
                pr={pr}
                file={f}
                set={fileSet.data!}
                iterationId={latest.id}
                threads={buckets.byFile.get(f.path) ?? []}
                onChanged={onChanged}
              />
            ))}
            {paging.hasMore && <MoreSentinel onVisible={paging.more} version={paging.limit} label={`Showing ${paging.limit} of ${shown.length} files, scroll for more...`} />}
          </div>
        </div>
      )}
    </div>
  );
}

function DiffFile({ pr, file, set, iterationId, threads, onChanged }: {
  pr: PrInfo;
  file: FileEntry;
  set: FileSet;
  iterationId: number;
  threads: GitPullRequestCommentThread[];
  onChanged: () => void;
}) {
  const service = useService();
  const [open, setOpen] = React.useState(true);
  const [expanded, setExpanded] = React.useState(new Set<number>());
  const [composeAt, setComposeAt] = React.useState<DiffRow>();
  const viewedKey = `sp.viewed:${pr.id}:${file.path}:${file.newObjectId ?? "deleted"}`;
  const [viewed, setViewed] = React.useState(() => {
    try {
      return localStorage.getItem(viewedKey) === "1";
    } catch {
      return false;
    }
  });
  const toggleViewed = (v: boolean) => {
    setViewed(v);
    try {
      v ? localStorage.setItem(viewedKey, "1") : localStorage.removeItem(viewedKey);
    } catch {
      /* ignore */
    }
    if (v) setOpen(false);
  };

  const content = useAsync(async () => {
    const isAdd = (file.changeType & 1) !== 0;
    const isDelete = (file.changeType & 16) !== 0;
    const oldPath = file.originalPath || file.path;
    const [oldText, newText] = await Promise.all([
      isAdd ? Promise.resolve("") : service.getFileText(pr.repositoryId, oldPath, set.baseSha),
      isDelete ? Promise.resolve("") : service.getFileText(pr.repositoryId, file.path, set.headSha)
    ]);
    return { oldText, newText, full: buildDiffRows(oldText, newText, -1), collapsed: buildDiffRows(oldText, newText, 3), newLines: newText.split(/\r?\n/) };
  }, [file.path, set.baseSha, set.headSha]);

  const result = content.data;
  const rows = React.useMemo(() => {
    if (!result) return [];
    const out: DiffRow[] = [];
    for (const r of result.collapsed.rows) {
      if (r.type === "gap" && r.gapStartNew !== undefined && expanded.has(r.gapStartNew)) out.push(...expandGap(r, result.full.rows));
      else out.push(r);
    }
    return out;
  }, [result, expanded]);
  // Rows are windowed too: a large file shows its first screenfuls and grows on scroll, up to the hard cap.
  const rowPaging = useIncremental(Math.min(rows.length, MAX_ROWS), ROW_STEP, result);
  const visible = React.useMemo(() => rows.slice(0, Math.min(rowPaging.limit, MAX_ROWS)), [rows, rowPaging.limit]);
  const truncated = rows.length > MAX_ROWS && rowPaging.limit >= MAX_ROWS;
  const placed = React.useMemo(() => placeThreads(threads, visible), [threads, visible]);

  const submit = async (row: DiffRow, text: string) => {
    const latestIterations = await service.getIterations(pr.repositoryId, pr.id);
    const latest = latestIterations[latestIterations.length - 1];
    if (latest.sourceRefCommit?.commitId !== set.headSha) {
      throw new Error("This pull request was updated since the page was loaded. Refresh to review the latest version.");
    }
    let leftLines: string[] | undefined;
    if (row.type === "delete" && set.nativeBaseSha) {
      leftLines = (await service.getFileText(pr.repositoryId, file.originalPath || file.path, set.nativeBaseSha)).split(/\r?\n/);
    }
    const anchor = anchorForRow(row, rows, leftLines);
    const lineText = row.newLine ? result?.newLines[row.newLine - 1] : row.text;
    const payload = buildThreadPayload({ filePath: file.path, anchor, text, iterationId, changeTrackingId: file.changeTrackingId, lineLength: lineText?.length });
    if (payload) {
      await service.createThread(pr, payload as never);
    } else {
      // The native view has no such line, so a PR-level comment that names the location keeps the feedback visible.
      await service.createThread(pr, { comments: [{ parentCommentId: 0, content: fallbackComment(file.path, anchor, text, row.newLine ?? row.oldLine), commentType: 1 }], status: 1 } as never);
    }
    setComposeAt(undefined);
    onChanged();
  };

  return (
    <div className="sp-diff-file">
      <div className="head">
        <span style={{ cursor: "pointer" }} onClick={() => setOpen((o) => !o)}>{open ? "▾" : "▸"}</span>
        <div>
          <div className="name">{fileName(file.path)} {result && <><span className="plus">+{result.full.added}</span> <span className="minus">-{result.full.removed}</span></>}</div>
          <div className="path">{dirName(file.path)}{file.originalPath && file.originalPath !== file.path ? ` (renamed from ${file.originalPath})` : ""}</div>
        </div>
        <span className="spacer" />
        <label className="sp-muted" style={{ fontSize: 12 }}>
          <input type="checkbox" checked={viewed} onChange={(e) => toggleViewed(e.target.checked)} /> Viewed
        </label>
      </div>
      {open && (
        <>
          {truncated && <div className="banner">Displayed content is truncated due to maximum viewable content limit.</div>}
          <ErrorBanner error={content.error} />
          {content.loading && <Spinner />}
          {placed.fileLevel.map((t) => <div key={t.id} style={{ padding: "6px 12px" }}><ThreadView pr={pr} thread={t} onChanged={onChanged} /></div>)}
          {result && (
            <table className="sp-diff">
              <colgroup><col style={{ width: 46 }} /><col style={{ width: 46 }} /><col style={{ width: 16 }} /><col /></colgroup>
              <tbody>
                {visible.map((row, i) => {
                  if (row.type === "gap") {
                    return (
                      <tr className="gap" key={`g${i}`} onClick={() => setExpanded((s) => new Set(s).add(row.gapStartNew!))}>
                        <td colSpan={4}>Show {row.hidden} hidden lines</td>
                      </tr>
                    );
                  }
                  const line = row.newLine;
                  const inline = line !== undefined && row.type !== "delete" ? placed.inline.get(line) : undefined;
                  return (
                    <React.Fragment key={i}>
                      <tr className={row.type}>
                        <td className="num">{row.oldLine}</td>
                        <td className="num">
                          {row.newLine}
                          <button className="plus-btn" title="Add a comment" onClick={() => setComposeAt(row)}>+</button>
                        </td>
                        <td className="sign">{row.type === "add" ? "+" : row.type === "delete" ? "-" : ""}</td>
                        <td className="code">{row.text}</td>
                      </tr>
                      {inline && (
                        <tr className="threads">
                          <td colSpan={4}>
                            {inline.map((t) => <ThreadView key={t.id} pr={pr} thread={t} onChanged={onChanged} />)}
                          </td>
                        </tr>
                      )}
                      {composeAt === row && (
                        <tr className="threads">
                          <td colSpan={4}>
                            {row.type === "delete" && <div className="sp-muted" style={{ fontSize: 11, marginBottom: 4 }}>Commenting on a removed line: it is attached to the nearest remaining line and quotes the removed text.</div>}
                            <Composer autoFocus submitLabel="Comment" onCancel={() => setComposeAt(undefined)} onSubmit={(t) => submit(row, t)} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
          {result && rowPaging.hasMore && <MoreSentinel onVisible={rowPaging.more} version={rowPaging.limit} label="Loading more lines..." />}
        </>
      )}
    </div>
  );
}
