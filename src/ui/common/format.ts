export function initials(name: string | undefined): string {
  const parts = (name ?? "?").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const UNITS: [number, string][] = [
  [60, "second"],
  [60, "minute"],
  [24, "hour"],
  [7, "day"],
  [4.345, "week"],
  [12, "month"],
  [Infinity, "year"]
];

/** "3 minutes ago" style text; very recent times read "Just now" like the native page. */
export function timeAgo(date: Date | string | undefined, now: Date = new Date()): string {
  if (!date) return "";
  let diff = Math.floor((now.getTime() - new Date(date).getTime()) / 1000);
  if (diff < 45) return "Just now";
  for (const [size, unit] of UNITS) {
    if (diff < size * 1.0) {
      const n = Math.max(1, Math.round(diff));
      return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
    }
    diff /= size;
  }
  return "";
}

/** "Oct 5" for the current year, "Oct 5, 2025" otherwise - the format used on the native activity feed. */
export function shortDate(date: Date | string | undefined, now: Date = new Date()): string {
  if (!date) return "";
  const d = new Date(date);
  const base = d.toLocaleString("en-US", { month: "short", day: "numeric" });
  return d.getFullYear() === now.getFullYear() ? base : `${base}, ${d.getFullYear()}`;
}

export function dateTime(date: Date | string | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  return `${shortDate(d)} at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

export function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function dirName(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}

export function shortSha(sha: string | undefined): string {
  return (sha ?? "").slice(0, 8);
}

/** Builds the stack-aware deep link query used by the hub. */
export function prQuery(repoId: string, prId: number): Record<string, string> {
  return { repo: repoId, pr: String(prId) };
}
