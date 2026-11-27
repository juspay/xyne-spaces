import { format, startOfDay } from 'date-fns';
import type { Ticket } from '@xyne/shared';

export type TicketCalendarDateMode = 'created' | 'eta';

/** ETA mode omits undated tickets; it never substitutes or mutates createdAt. */
export function groupTicketsByDate(
  tickets: Ticket[],
  mode: TicketCalendarDateMode = 'created',
): Map<string, Ticket[]> {
  const grouped = new Map<string, Ticket[]>();
  for (const ticket of tickets) {
    const value = mode === 'eta' ? ticket.eta : ticket.createdAt;
    if (value === null || value === undefined) continue;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) continue;
    const key = format(startOfDay(date), 'yyyy-MM-dd');
    const entries = grouped.get(key) ?? [];
    entries.push(ticket);
    grouped.set(key, entries);
  }
  return grouped;
}

/** Keep undated and invalid-date tickets reachable without treating epoch zero as absent. */
export function ticketsWithoutEta(tickets: readonly Ticket[]): Ticket[] {
  return tickets.filter(
    ticket =>
      ticket.eta === null ||
      ticket.eta === undefined ||
      !Number.isFinite(new Date(ticket.eta).getTime()),
  );
}
