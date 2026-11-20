import { z } from 'zod/v3';
import { TicketPriority, TicketStatusV2 } from '@xyne/shared';

/**
 * The ticket a trigger exposes as `trigger.ticket.*`. Mirrors `TicketSchema` in
 * automations/triggers/ticket-context.ts, field for field.
 */
const TicketSchema = z.object({
  id: z.string(),
  url: z.string().url().nullable(),
  xyneId: z.string().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  statusV2: z.nativeEnum(TicketStatusV2).nullable(),
  priority: z.nativeEnum(TicketPriority).nullable(),
  ticketType: z.string().nullable(),
  stageName: z.string().nullable(),
  boardId: z.string().nullable(),
  channelId: z.string().nullable(),
  conversationId: z.string().nullable(),
  projectId: z.string().nullable(),
  userGroupId: z.string().nullable(),
  createdBy: z.string().nullable(),
  updatedBy: z.string().nullable(),
  assignedTo: z.string().nullable(),
  closedAt: z.coerce.date().nullable(),
  closedBy: z.string().nullable(),
  eta: z.coerce.date().nullable(),
  merchantId: z.string().nullable(),
  isArchived: z.boolean().nullable(),
  aiCategory: z.string().nullable(),
  aiSubCategory: z.string().nullable(),
  referenceTicket: z.array(z.string()).nullable(),
  metadata: z.unknown().nullable(),
  lastEmailAt: z.coerce.date().nullable(),
  statusUpdatedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date().nullable(),
  updatedAt: z.coerce.date().nullable(),
});

export const TicketContextSchema = z.object({
  ticket: TicketSchema,
});
