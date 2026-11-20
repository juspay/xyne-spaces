// @xyne/workflow-sdk builds its schemas with zod/v3 from the repo's zod; use that same copy.
import { z } from 'zod/v3';
import { TicketPriority, TicketStatusV2 } from '@xyne/shared';

/**
 * zod/v3 mirrors of the schemas the Automations engine declares on zod v4.
 *
 * The SDK turns a trigger's schemas into JSON Schema with a v3-only converter, so the
 * ones handed to it cannot be v4 — and the Automations originals are not ours to move.
 * Keep each mirror field-for-field with its original:
 * - TicketContextSchema
 *   → automations/triggers/ticket-context.ts
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

const BoardSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  createdBy: z.string().nullable(),
});

const ProjectSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  code: z.string().nullable(),
});

const ChannelSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  type: z.string().nullable(),
});

const UserSummarySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
});

const UserGroupSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
});

const LastEmailsSchema = z.object({
  lastReplyAt: z.coerce.date().nullable(),
  lastAgentReplyAt: z.coerce.date().nullable(),
  lastCustomerReplyAt: z.coerce.date().nullable(),
});

export const TicketContextSchema = z.object({
  ticket: TicketSchema,
  board: BoardSchema.nullable(),
  project: ProjectSchema.nullable(),
  channel: ChannelSchema.nullable(),
  assignee: UserSummarySchema.nullable(),
  creator: UserSummarySchema.nullable(),
  group: UserGroupSchema.nullable(),
  lastEmails: LastEmailsSchema,
});
