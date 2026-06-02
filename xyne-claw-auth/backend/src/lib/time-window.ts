/**
 * Shared time-window parsing for dashboard / analytics endpoints.
 *
 * Accepts:
 *   - "all"           → null (no cutoff; "all-time" view)
 *   - a positive int  → { start: now - (N-1) days at 00:00, end: now }
 *   - anything else   → null (caller treats as all-time)
 *
 * The off-by-one (`days - 1`) keeps `days=1` meaning "today only" rather
 * than "today + yesterday". Aligns with how the admin + per-user dashboards
 * label their time-range pickers.
 */

export interface TimeWindow {
  start: Date;
  end: Date;
}

export function windowFromDays(daysParam: unknown): TimeWindow | null {
  if (daysParam === "all") return null;
  const days = typeof daysParam === "string" ? parseInt(daysParam, 10) : NaN;
  if (!Number.isFinite(days) || days <= 0) return null;
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);
  return { start, end };
}
