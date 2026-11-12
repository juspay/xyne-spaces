// @xyne/workflow-sdk is built on zod v3; its schemas must come from that exact copy (aliased in package.json).
import { z } from 'zod-v3';
import { CallType, TicketPriority, TicketStatusV2 } from '@xyne/shared';
import { CALL_STARTED, CALL_ENDED } from '@/automations/triggers/call.trigger';
import { AUTOMATION_TEMPLATE_MAX_FILE_BYTES } from '@/automations/services/automation-template.service';

/**
 * zod-v3 mirrors of the schemas the Automations engine declares on zod v4.
 *
 * The SDK turns a trigger's schemas into JSON Schema with a v3-only converter, so the
 * ones handed to it cannot be v4 — and the Automations originals are not ours to move.
 * Keep each mirror field-for-field with its original:
 * - TicketContextSchema, TicketUpdatedFieldSchema, FormFieldConditionSchema, TicketChangeSchema,
 *   TicketUpdatedOutputSchema → automations/triggers/ticket-context.ts and ticket-updated-schema.ts
 * - CallEventOutputSchema → automations/triggers/call.trigger.ts
 * - AutomationTemplateAttachmentSchema → automations/services/automation-template.service.ts
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

export const TicketUpdatedFieldSchema = z.enum([
  'statusV2',
  'assignedTo',
  'priority',
  'stageName',
  'title',
  'description',
  'eta',
  'boardId',
  'userGroupId',
]);

export const FormFieldConditionSchema = z
  .object({
    fieldId: z.string().min(1),
    match: z.enum(['changed', 'contains']).default('changed'),
    value: z
      .string()
      .optional()
      .describe('Substring to look for in the new field value when match is "contains".'),
  })
  .superRefine((val, ctx) => {
    if (val.match === 'contains' && !(val.value ?? '').trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A contains value is required when match is "contains".',
        path: ['value'],
      });
    }
  });

export const TicketChangeSchema = z.object({
  previousValue: z.union([z.string(), z.number(), z.null()]).optional(),
  newValue: z.union([z.string(), z.number(), z.null()]).optional(),
});

export const TicketUpdatedOutputSchema = TicketContextSchema.extend({
  changes: z.record(TicketUpdatedFieldSchema, TicketChangeSchema),
  formFieldChanges: z.record(z.string(), TicketChangeSchema).optional(),
  performedBy: z.object({
    id: z.string().nullable(),
  }),
});

const ParticipantUserSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
});

export const CallEventOutputSchema = z.object({
  callEventType: z.enum([CALL_STARTED, CALL_ENDED]),
  callId: z.string(),
  externalId: z.string(),
  channelId: z.string().nullable(),
  title: z.string().nullable(),
  callType: z.nativeEnum(CallType),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().nullable(),
  durationSeconds: z.number().nullable(),
  aiSummary: z.string().nullable(),
  transcript: z.string().nullable(),
  conversationId: z.string().nullable(),
  participantUsers: z.array(ParticipantUserSchema),
});

export const AutomationTemplateAttachmentSchema = z.object({
  attachmentId: z.string().min(1),
  originalFilename: z.string().min(1),
  mimetype: z.enum(['text/plain', 'text/markdown', 'text/html']),
  size: z.number().int().nonnegative().max(AUTOMATION_TEMPLATE_MAX_FILE_BYTES),
  templatePaths: z.array(z.string().min(1)),
});
