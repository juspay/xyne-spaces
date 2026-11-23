import { z } from 'zod';
import { defineRequestContract } from '../define.js';
import { derive } from '../extractors.js';
import { unreadableString } from '../unreadable-string.js';

/**
 * Zero mutator `subTicket.create`. The client encrypts `title` and `description`; both are
 * stored as received. `description` lists one fact so that "no facts" means it was empty, which
 * is how `description || null` is kept.
 */
export const subTicketCreateClient = defineRequestContract({
  sourceToDerived: {
    title: {},
    description: { textLength: derive.textLength },
  },
  schema: z.object({
    subTicketId: z.string(),
    mappingId: z.string(),
    timestamp: z.number(),
    title: unreadableString(),
    description: unreadableString().optional(),
    ticketId: z.string(),
    conversationId: z.string().optional(),
    subTicketXyneId: z.string().optional(),
  }),
});
