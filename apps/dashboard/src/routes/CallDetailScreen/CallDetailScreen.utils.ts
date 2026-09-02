import { format } from 'date-fns';

type Timestamp = number | string | Date | null | undefined;

function toDate(value: Timestamp): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Date + time half of the call-detail meta line, e.g. "Tue Aug 4, 2026 · 3:12 PM".
 */
export function formatCallHeldOn(startedAt: Timestamp): string | null {
  const date = toDate(startedAt);
  if (!date) return null;
  return `${format(date, 'EEE MMM d, yyyy')} · ${format(date, 'h:mm a')}`;
}

/**
 * Compact call length for the meta line, e.g. "22 min", "1 hr 5 min".
 * Sub-minute calls round up so a 12s call doesn't read as "0 min".
 */
export function formatCallLength(durationMs: number | null): string | null {
  if (!durationMs || durationMs <= 0) return null;
  const totalMinutes = Math.max(1, Math.round(durationMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}
