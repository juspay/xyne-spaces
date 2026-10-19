const ETA_MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** Dashboard `formatETADisplay` — local `"D Mon, H:MM AM/PM"`. */
export function formatETADisplay(eta: number | null | undefined): string {
  if (!eta) return '—';
  const date = new Date(eta);
  const day = date.getDate();
  const month = ETA_MONTH_NAMES[date.getMonth()] ?? '';
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const displayMinutes = minutes.toString().padStart(2, '0');
  return `${day} ${month}, ${displayHours}:${displayMinutes} ${period}`;
}

/**
 * Ticket-details overdue (dashboard wall-clock): past `eta` and not
 * COMPLETED / CANCELLED. Same rule for Status Deadline (`stageEta`).
 */
export function isTicketDueDateOverdue(
  eta: number | null | undefined,
  statusV2: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!eta || !Number.isFinite(eta)) return false;
  const status = (statusV2 ?? '').trim().toUpperCase();
  if (status === 'COMPLETED' || status === 'CANCELLED') return false;
  return eta < now;
}

/** Alias for Status Deadline overdue chip (`Stage Overdue`). */
export const isStageDeadlineOverdue = isTicketDueDateOverdue;
