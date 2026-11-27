import { route } from '../../enc-contracts/api-route.js';
import { z } from 'zod';

// ── Sub-tickets (/sub-tickets/...) ──────────────────────────────────────────

const requiredId = (message: string) => z.string().refine((value) => value.trim().length > 0, message);

/** `/sub-tickets`: linking a ticket under another. Key order is the mount order. */
export const subTickets = route('/sub-tickets', {
  link: {
    method: 'POST',
    path: '/link',
    body: z.object({
      ticketId: requiredId('ticketId is required'),
      mappedTicketId: requiredId('mappedTicketId is required'),
      subTicketTitle: z.unknown().optional(),
    }),
    response: z.object({ subTicketId: z.string(), mappingId: z.string() }),
  },
  unlink: {
    method: 'POST',
    path: '/unlink',
    body: z.object({ mappingId: requiredId('mappingId is required') }),
    response: z.null(),
  },
});
