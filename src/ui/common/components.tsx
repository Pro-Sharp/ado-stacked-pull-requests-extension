import * as React from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { StackHealth } from "../../core/stack/types";
import { voteKind, VoteKind, voteLabel } from "../../core/api/mapping";
import { initials } from "./format";

export function Avatar({ name, url, size = 20 }: { name?: string; url?: string; size?: number }) {
  return (
    <span className="sp-avatar" style={{ width: size, height: size, fontSize: Math.max(8, size * 0.42) }} title={name}>
      {url ? <img src={url} alt="" /> : initials(name)}
    </span>
  );
}

export function Spinner({ text = "Loading..." }: { text?: string }) {
  return <div className="sp-spinner">{text}</div>;
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error);
  return <div className="sp-error">{msg}</div>;
}

/** Dropdown anchored to a trigger; closes on outside click / Escape. */
export function Menu({ trigger, children }: { trigger: (toggle: () => void, open: boolean) => React.ReactNode; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <span ref={ref} style={{ position: "relative", display: "inline-block" }}>
      {trigger(() => setOpen((o) => !o), open)}
      {open && <div className="sp-menu">{children(() => setOpen(false))}</div>}
    </span>
  );
}

const marks: Record<VoteKind, { cls: string; glyph: string } | undefined> = {
  approved: { cls: "approved", glyph: "✓" },
  "approved-with-suggestions": { cls: "suggest", glyph: "✓" },
  waiting: { cls: "waiting", glyph: "…" },
  rejected: { cls: "rejected", glyph: "✕" },
  none: undefined
};

export function Reviewers({ reviewers }: { reviewers: { id?: string; displayName?: string; imageUrl?: string; vote: number }[] }) {
  if (!reviewers.length) return <span className="sp-muted">-</span>;
  return (
    <div className="sp-reviewers">
      {reviewers.map((r, i) => {
        const m = marks[voteKind(r.vote)];
        return (
          <span className="rv" key={r.id ?? i} title={`${r.displayName ?? ""}: ${voteLabel(r.vote)}`}>
            <Avatar name={r.displayName} url={r.imageUrl} size={22} />
            {m && <span className={`badge ${m.cls}`}>{m.glyph}</span>}
          </span>
        );
      })}
    </div>
  );
}

const HEALTH: Record<StackHealth, { text: string; cls: string; title: string } | undefined> = {
  root: undefined,
  "in-sync": { text: "In sync", cls: "success", title: "Contains the latest commit of its parent PR" },
  "parent-ahead": { text: "Parent ahead", cls: "warn", title: "The parent PR has newer commits: rebase this branch onto it" },
  "parent-merged": { text: "Parent merged", cls: "warn", title: "The parent PR was completed: retarget / rebase onto the trunk" },
  "parent-abandoned": { text: "Parent abandoned", cls: "danger", title: "The parent PR was abandoned" }
};

export function HealthPill({ health, conflicts }: { health: StackHealth; conflicts?: boolean }) {
  const h = HEALTH[health];
  return (
    <>
      {h && (
        <span className={`sp-pill ${h.cls}`} title={h.title}>
          {h.text}
        </span>
      )}
      {conflicts && (
        <span className="sp-pill danger" title="Merge conflicts">
          Conflicts
        </span>
      )}
    </>
  );
}

export function Markdown({ text, className = "sp-description" }: { text?: string; className?: string }) {
  const html = React.useMemo(() => {
    if (!text) return "";
    const raw = marked.parse(text, { async: false, gfm: true, breaks: true }) as string;
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  }, [text]);
  if (!html) return null;
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * Invisible marker placed after a partially rendered list. When it scrolls into (or near) view it calls `onVisible`,
 * which grows the list: the infinite-scroll pattern of the native PR pages. `version` must change whenever more
 * items were added so the observer re-arms (an observer only fires on a visibility change). Without
 * IntersectionObserver (old hosts, tests) it asks for more immediately, i.e. the list renders in full.
 */
export function MoreSentinel({ onVisible, version, label = "Loading more..." }: { onVisible: () => void; version: number; label?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      onVisible();
      return;
    }
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onVisible(), { rootMargin: "600px" });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  return (
    <div ref={ref} className="sp-muted" style={{ textAlign: "center", padding: 12, fontSize: 12 }}>
      {label}
    </div>
  );
}

/** Windowed rendering state: show `step` items first and grow by `step` each time the sentinel is reached. */
export function useIncremental(total: number, step: number, resetKey: unknown = undefined): { limit: number; more: () => void; hasMore: boolean } {
  const [limit, setLimit] = React.useState(step);
  React.useEffect(() => setLimit(step), [resetKey, step]);
  const more = React.useCallback(() => setLimit((l) => l + step), [step]);
  return { limit, more, hasMore: limit < total };
}

export function useAsync<T>(load: () => Promise<T>, deps: React.DependencyList): { data?: T; error?: unknown; loading: boolean; reload: () => void } {
  const [state, setState] = React.useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    load().then(
      (data) => alive && setState({ data, loading: false }),
      (error) => alive && setState({ error, loading: false })
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}
