import { format } from 'date-fns';

/** "Sep 4, 2026"; em dash for missing / invalid values. */
export function formatTicketDate(timestamp: number | null | undefined): string {
  if (!timestamp || !Number.isFinite(timestamp)) return '—';
  return format(timestamp, 'MMM d, yyyy');
}
