import { TicketStatusV2 } from '@xyne/shared';

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Dashboard `isEtaUrgent`: the due date is before today (day granularity) and the
 * ticket is not COMPLETED / CANCELLED. A due date of "today" is not yet overdue.
 */
export function isEtaUrgent(
  eta: number | null | undefined,
  status: TicketStatusV2 | string | null | undefined,
  now: number,
): boolean {
  if (!eta || !Number.isFinite(eta)) return false;
  if (status === TicketStatusV2.COMPLETED || status === TicketStatusV2.CANCELLED) return false;
  return startOfLocalDay(eta) < startOfLocalDay(now);
}
