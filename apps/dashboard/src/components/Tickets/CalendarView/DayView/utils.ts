import { startOfDay, format } from 'date-fns';
import type { Ticket } from '@xyne/shared';

/**
 * Groups tickets by their creation date (YYYY-MM-DD format)
 */
export function groupTicketsByDate(tickets: Ticket[]): Map<string, Ticket[]> {
  const grouped = new Map<string, Ticket[]>();

  tickets.forEach(ticket => {
    if (!ticket.createdAt) return;
    const dateKey = format(startOfDay(new Date(ticket.createdAt)), 'yyyy-MM-dd');
    if (!grouped.has(dateKey)) {
      grouped.set(dateKey, []);
    }
    const ticketsForDate = grouped.get(dateKey);
    if (ticketsForDate) {
      ticketsForDate.push(ticket);
    }
  });

  return grouped;
}
