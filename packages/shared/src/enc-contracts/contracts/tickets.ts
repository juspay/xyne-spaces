import { z } from 'zod';
import { defineRequestContract } from '../define.js';
import { unreadableString } from '../unreadable-string.js';

/**
 * Zero mutator `ticket.update`. The client encrypts `description`; it is stored as received.
 * Clients send `description` only when it changed (they compare the plaintext), so the server
 * treats "sent" as "changed": it cannot compare two encrypted values.
 */
export const ticketUpdateClient = defineRequestContract({
  sourceToDerived: { description: {} },
  schema: z.object({
    id: z.string(),
    title: z.string().optional(),
    description: unreadableString().optional(),
    statusV2: z.string().optional(),
    priority: z.string().optional(),
    stageName: z.string().optional(),
    assignedTo: z.string().nullable().optional(),
    ticketType: z.string().optional(),
    userGroupId: z.string().nullable().optional(),
    eta: z.number().optional(),
    boardId: z.string().optional(),
    metadata: z.any().optional(),
    isArchived: z.boolean().optional(),
    kanbanPosition: z.string().nullable().optional(),
    updatedAt: z.number(),
  }),
});
