/**
 * Shared time-formatting utilities for relative and absolute timestamps.
 *
 * `formatRelativeTime`  → "just now", "2m ago", "1h ago", "3d ago", "2w ago"
 * `formatAbsoluteTime`  → "May 20, 2026, 2:30 PM" (locale-formatted)
 * `getTimeDiffMs`       → raw millisecond difference (used by the hook)
 */

export function formatRelativeTime(
  iso: string | null | undefined | Date,
  now: Date = new Date(),
): string {
  if (!iso) return "never";

  const then = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  if (Number.isNaN(then)) return "never";

  const diffMs = now.getTime() - then;

  // Future dates
  if (diffMs < 0) {
    const absSec = Math.abs(Math.floor(diffMs / 1000));
    if (absSec < 60) return "in a moment";
    if (absSec < 3600) return `in ${Math.floor(absSec / 60)}m`;
    if (absSec < 86400) return `in ${Math.floor(absSec / 3600)}h`;
    return `in ${Math.floor(absSec / 86400)}d`;
  }

  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return "just now";
  if (diffSec < 3600) {
    const m = Math.floor(diffSec / 60);
    return `${m}m ago`;
  }
  if (diffSec < 86400) {
    const h = Math.floor(diffSec / 3600);
    return `${h}h ago`;
  }
  if (diffSec < 604800) {
    const d = Math.floor(diffSec / 86400);
    return `${d}d ago`;
  }
  if (diffSec < 2592000) {
    const w = Math.floor(diffSec / 604800);
    return `${w}w ago`;
  }

  // Older than 30 days — show absolute date
  const date = new Date(then);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatAbsoluteTime(
  iso: string | null | undefined | Date,
): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Raw millisecond difference (negative = future). */
export function getTimeDiffMs(
  iso: string | null | undefined | Date,
  now: Date = new Date(),
): number | null {
  if (!iso) return null;
  const then = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  if (Number.isNaN(then)) return null;
  return now.getTime() - then;
}
