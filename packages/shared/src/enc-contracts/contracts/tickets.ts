import { z } from 'zod';
import { defineRequestContract, type RequestOf } from '../define.js';

/**
 * Zero mutator `ticket.update`. `description` is stored as sent into `tickets` and mirrored
 * into `ticket_descriptions`; nothing is derived. Because ciphertext differs on every
 * encryption, the mutator's "did the description change" compare treats every provided
 * description as a change. `title` and every other field stay plaintext for now.
 */
export const ticketUpdateClient = defineRequestContract({
  encrypted: ['description'],
  derived: [],
  schema: z.object({
    id: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
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

export type TicketUpdateRequest = RequestOf<typeof ticketUpdateClient>;

/**
 * Zero mutator `subTicket.create`. `description` is stored as sent. `title` stays plaintext:
 * the mutator copies it into the ticket activity's JSON value, which clients do not decrypt.
 */
export const subTicketCreateClient = defineRequestContract({
  encrypted: ['description'],
  derived: [],
  schema: z.object({
    subTicketId: z.string(),
    mappingId: z.string(),
    timestamp: z.number(),
    title: z.string(),
    description: z.string().optional(),
    ticketId: z.string(),
    conversationId: z.string().optional(),
    subTicketXyneId: z.string().optional(),
  }),
});

export type SubTicketCreateRequest = RequestOf<typeof subTicketCreateClient>;
