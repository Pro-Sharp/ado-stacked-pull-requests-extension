import * as React from "react";
import { CommentThreadStatus, GitPullRequestCommentThread } from "azure-devops-extension-api/Git";
import { PrInfo } from "../../core/stack/types";
import { Avatar, Markdown } from "../common/components";
import { timeAgo } from "../common/format";
import { useService } from "../context";

export const STATUS_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "Active" },
  { value: 6, label: "Pending" },
  { value: 2, label: "Resolved" },
  { value: 3, label: "Won't fix" },
  { value: 5, label: "By design" },
  { value: 4, label: "Closed" }
];

/** A textarea with a Comment / Cancel footer, used for new threads and PR-level comments. */
export function Composer({ placeholder = "Add a comment...", submitLabel = "Comment", initial = "", onSubmit, onCancel, autoFocus }: {
  placeholder?: string;
  submitLabel?: string;
  initial?: string;
  onSubmit: (text: string) => Promise<void>;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = React.useState(initial);
  const [open, setOpen] = React.useState(!!autoFocus || !!initial);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string>();

  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setErr(undefined);
    try {
      await onSubmit(text);
      setText("");
      if (!autoFocus) setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return <input className="sp-input" style={{ width: "100%" }} placeholder={placeholder} onFocus={() => setOpen(true)} readOnly />;
  }
  return (
    <div>
      <textarea
        className="sp-input"
        style={{ width: "100%", minHeight: 70 }}
        autoFocus
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") submit();
          if (e.key === "Escape" && onCancel) onCancel();
        }}
      />
      <div className="hint sp-muted" style={{ fontSize: 11, marginTop: 4 }}>
        Markdown supported. Ctrl+Enter to submit.
      </div>
      {err && <div className="sp-error" style={{ marginTop: 6 }}>{err}</div>}
      <div className="row" style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
        <button className="sp-btn" onClick={() => (onCancel ? onCancel() : (setOpen(false), setText("")))}>
          Cancel
        </button>
        <button className="sp-btn primary" disabled={busy || !text.trim()} onClick={submit}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

export function ThreadView({ pr, thread, onChanged }: { pr: PrInfo; thread: GitPullRequestCommentThread; onChanged: () => void }) {
  const service = useService();
  const [editing, setEditing] = React.useState<number>();
  const [err, setErr] = React.useState<string>();
  const comments = (thread.comments ?? []).filter((c) => !c.isDeleted && (c.commentType as unknown) !== 3);
  if (comments.length === 0) return null;
  const guard = async (fn: () => Promise<unknown>) => {
    try {
      setErr(undefined);
      await fn();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const me = service.ctx.userId;

  return (
    <div className="sp-card sp-thread">
      {err && <div className="sp-error">{err}</div>}
      {comments.map((c, idx) => {
        const liked = (c.usersLiked ?? []).some((u) => u.id === me);
        return (
          <div className="comment" key={c.id}>
            <Avatar name={c.author?.displayName} url={c.author?.imageUrl} size={28} />
            <div className="body">
              <div className="who">
                <span className="name">{c.author?.displayName}</span>
                <span className="when">{timeAgo(c.publishedDate)}</span>
                <span className="spacer" />
                {idx === 0 && (
                  <select
                    className="status"
                    value={thread.status ?? 1}
                    onChange={(e) => guard(() => service.setThreadStatus(pr, thread.id, Number(e.target.value) as CommentThreadStatus))}
                    aria-label="Thread status"
                  >
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {editing === c.id ? (
                <Composer
                  autoFocus
                  initial={c.content}
                  submitLabel="Save"
                  onCancel={() => setEditing(undefined)}
                  onSubmit={async (t) => {
                    await service.editComment(pr, thread.id, c.id, t);
                    setEditing(undefined);
                    onChanged();
                  }}
                />
              ) : (
                <>
                  <Markdown text={c.content} className="text" />
                  <div className="tools">
                    <button className={liked ? "liked" : ""} onClick={() => guard(() => service.like(pr, thread.id, c.id, !liked))}>
                      {liked ? "Unlike" : "Like"}
                      {(c.usersLiked?.length ?? 0) > 0 ? ` (${c.usersLiked!.length})` : ""}
                    </button>
                    {c.author?.id === me && <button onClick={() => setEditing(c.id)}>Edit</button>}
                    {c.author?.id === me && (
                      <button onClick={() => window.confirm("Delete this comment?") && guard(() => service.deleteComment(pr, thread.id, c.id))}>Delete</button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })}
      <div className="reply">
        <div style={{ flex: 1 }}>
          <Composer placeholder="Write a reply..." submitLabel="Reply" onSubmit={async (t) => (await service.addComment(pr, thread.id, t), onChanged())} />
        </div>
        {(thread.status ?? 1) === 1 && (
          <button className="sp-btn" onClick={() => guard(() => service.setThreadStatus(pr, thread.id, 2 as CommentThreadStatus))}>
            Resolve
          </button>
        )}
      </div>
    </div>
  );
}
