// Small date helpers shared across Digital Twin memory views.

export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Compact relative-time formatter — "23h ago", "3d ago", "just now". */
export function fmtRelative(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return fmtDate(iso);
}

/** Confidence/score → semantic tone class (green ≥0.8, amber ≥0.6, red below).
 *  Uses the same status tokens as Pill so tones stay consistent across themes. */
export function scoreToneClass(score: number): string {
  if (score >= 0.8) return 'text-status-success';
  if (score >= 0.6) return 'text-status-pending';
  return 'text-status-failure';
}
