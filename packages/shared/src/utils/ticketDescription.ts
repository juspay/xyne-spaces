/**
 * Resolves the effective description for a ticket.
 *
 * If the ticket has an associated TicketDescription record (via the
 * `ticketDescription` relation), that value takes precedence. Otherwise,
 * fall back to the legacy `description` field on the ticket itself.
 *
 * This helper centralizes the resolution logic so frontend components and
 * backend services can use a consistent value.
 */
export function resolveTicketDescription(
  ticket:
    | {
        description?: string | null;
        ticketDescription?: { description?: string | null } | null | undefined;
      }
    | null
    | undefined,
): string {
  if (!ticket) {
    return '';
  }

  const newDescription = ticket.ticketDescription?.description;
  if (typeof newDescription === 'string') {
    return newDescription;
  }

  return ticket.description ?? '';
}
