import { z } from 'zod';
import { defineRoute } from '../../enc-contracts/api-route.js';

// ── Sub-tickets (/sub-tickets/...) ──────────────────────────────────────────

const requiredId = (message: string) => z.string().refine((value) => value.trim().length > 0, message);

export const subTicketsLink = defineRoute({
  method: 'POST',
  path: '/link',
  body: z.object({
    ticketId: requiredId('ticketId is required'),
    mappedTicketId: requiredId('mappedTicketId is required'),
    subTicketTitle: z.unknown().optional(),
  }),
  response: z.object({ subTicketId: z.string(), mappingId: z.string() }),
});

export const subTicketsUnlink = defineRoute({
  method: 'POST',
  path: '/unlink',
  body: z.object({ mappingId: requiredId('mappingId is required') }),
  response: z.null(),
});