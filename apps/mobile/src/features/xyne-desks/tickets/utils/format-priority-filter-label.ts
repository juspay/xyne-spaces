import { TicketPriority } from '@xyne/shared';

import { TICKET_PRIORITY_FILTER_OPTIONS } from '../constants';

const PRIORITY_LABEL_BY_VALUE: Record<TicketPriority, string> = {
  [TicketPriority.LOW]: 'Low',
  [TicketPriority.MEDIUM]: 'Medium',
  [TicketPriority.HIGH]: 'High',
  [TicketPriority.CRITICAL]: 'Critical',
};

/**
 * Canonical order for chip labels (matches dashboard Priority submenu).
 */
export function sortPrioritiesForFilterLabel(
  priorities: readonly TicketPriority[],
): TicketPriority[] {
  const order = TICKET_PRIORITY_FILTER_OPTIONS.map(o => o.value);
  return [...priorities].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/**
 * Gmail-style priority chip label:
 * - none → "Priority"
 * - one  → "High"
 * - many → "High + 2 more"
 */
export function formatPriorityFilterLabel(priorities: readonly TicketPriority[]): string {
  if (priorities.length === 0) return 'Priority';

  const sorted = sortPrioritiesForFilterLabel(priorities);
  const first = PRIORITY_LABEL_BY_VALUE[sorted[0]!] ?? 'Priority';
  if (sorted.length === 1) return first;

  const more = sorted.length - 1;
  return `${first} + ${more} more`;
}
