import { z } from 'zod';
import type { Conversation, Ticket } from '@prisma/client';
import { EmailType, MessageType, type CallType } from '@xyne/shared';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import type { AutomationContext } from '../types/context';
import { variableRef } from '../engine/variable-ref';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { tagService, DESK_EMAIL_SOURCE_TYPE } from '@/tags';
import { logger } from '@/utils/logger';
import { TICKET_CREATED_EVENT, ticketCreatedTrigger } from '../triggers/ticket-created.trigger';
import { TICKET_UPDATED_EVENT, ticketUpdatedTrigger } from '../triggers/ticket-updated.trigger';
import { EMAIL_RECEIVED_EVENT, emailReceivedTrigger } from '../triggers/email-received.trigger';
import { EMAIL_SENT_EVENT, emailSentTrigger } from '../triggers/email-sent.trigger';
import { TICKET_COMMENTED_EVENT, ticketCommentedTrigger } from '../triggers/ticket-commented.trigger';
import { MESSAGE_RECEIVED_EVENT, messageReceivedTrigger } from '../triggers/message-received.trigger';
import { CALL_EVENT, CALL_ENDED, CALL_STARTED, callTrigger } from '../triggers/call.trigger';
import { TAG_GENERATED_EVENT, tagGeneratedTrigger } from '../triggers/tag-generated.trigger';

// Each option resolves to exactly what that trigger hands downstream steps after hydration.
const RESOLVABLE_TRIGGERS = {
  [TICKET_CREATED_EVENT]: ticketCreatedTrigger,
  [TICKET_UPDATED_EVENT]: ticketUpdatedTrigger,
  [EMAIL_RECEIVED_EVENT]: emailReceivedTrigger,
  [EMAIL_SENT_EVENT]: emailSentTrigger,
  [TICKET_COMMENTED_EVENT]: ticketCommentedTrigger,
  [MESSAGE_RECEIVED_EVENT]: messageReceivedTrigger,
  [CALL_EVENT]: callTrigger,
  [TAG_GENERATED_EVENT]: tagGeneratedTrigger,
} as const;
type ResolveAs = keyof typeof RESOLVABLE_TRIGGERS;
const RESOLVE_AS_OPTIONS = Object.keys(RESOLVABLE_TRIGGERS) as [ResolveAs, ...ResolveAs[]];

const ResolveConversationConfigSchema = z.object({
  // Not named `conversationId`: that name makes the builder auto-bind the trigger's conversation.
  input: variableRef(z.string().min(1).describe('Any variable — its value is treated as a conversation id.')),
  resolveAs: z
    .array(z.enum(RESOLVE_AS_OPTIONS))
    .default([])
    .describe('Resolve the conversation into the same data each selected trigger provides.'),
});

const ResolveConversationOutputSchema = z.object({
  conversationId: z.string(),
  ticketId: z.string().nullable(),
  customFieldValues: z.record(z.string(), z.unknown()).nullable().describe('Ticket custom field values keyed by field name'),
  // One key per option, shaped by that trigger's own output; null when there is nothing to resolve.
  ...(Object.fromEntries<z.ZodTypeAny>(
    RESOLVE_AS_OPTIONS.map(type => [type, RESOLVABLE_TRIGGERS[type].outputSchema.nullable()]),
  ) as Record<ResolveAs, z.ZodTypeAny>),
});

type TicketRow = Pick<Ticket, 'id' | 'boardId' | 'projectId' | 'channelId' | 'createdBy'>;

export class ResolveConversationStep extends BaseActionStep<
  typeof ResolveConversationConfigSchema,
  Record<string, unknown>
> {
  readonly type = 'RESOLVE_CONVERSATION';
  readonly configSchema = ResolveConversationConfigSchema;
  readonly outputSchema = ResolveConversationOutputSchema;
  readonly name = 'Resolve conversation';
  readonly description =
    'Takes any variable as a conversation id and returns the same data each selected trigger would, plus the ticket custom fields.';
  readonly category = StepCategory.TICKET;
  readonly icon = 'Search';

  async execute(
    config: z.infer<typeof ResolveConversationConfigSchema>,
    context: AutomationContext,
  ): Promise<Record<string, unknown>> {
    const conversationId = config.input as string;

    const conversation = await db.conversation.findUnique({ where: { conversationId } });
    if (!conversation || conversation.workspaceId !== context.automation.workspaceId) {
      throw new Error(`[RESOLVE_CONVERSATION] conversation ${conversationId} not found in this workspace`);
    }

    const ticket = await db.ticket.findFirst({
      where: { conversationId },
      select: { id: true, boardId: true, projectId: true, channelId: true, createdBy: true },
    });

    const [resolved, customForm] = await Promise.all([
      Promise.all(
        config.resolveAs.map(async type => {
          const payload = await buildEventPayload(type, conversation, ticket);
          return [type, payload ? await RESOLVABLE_TRIGGERS[type].hydratePayload(payload as never) : null] as const;
        }),
      ),
      ticket ? repositories.forms.getTicketCustomFormData(ticket.id, ticket.boardId) : null,
    ]);

    logger.info(
      `[automations] RESOLVE_CONVERSATION conversation=${conversationId} ticket=${ticket?.id ?? '∅'} resolveAs=[${config.resolveAs.join(',')}]`,
    );

    return {
      conversationId,
      ticketId: ticket?.id ?? null,
      customFieldValues: customForm
        ? Object.fromEntries(customForm.fields.map(f => [f.fieldName, f.value]))
        : null,
      ...Object.fromEntries(RESOLVE_AS_OPTIONS.map(type => [type, null])),
      ...Object.fromEntries(resolved),
    };
  }
}

/** Rebuild the event payload the trigger's emitter would send, so its own hydratePayload produces the output. */
async function buildEventPayload(
  resolveAs: ResolveAs,
  conversation: Conversation,
  ticket: TicketRow | null,
): Promise<Record<string, unknown> | null> {
  const { conversationId, channelId } = conversation;
  const scope = ticket && { boardId: ticket.boardId, projectId: ticket.projectId, channelId: ticket.channelId };

  switch (resolveAs) {
    case TICKET_CREATED_EVENT:
      return ticket && { ticketId: ticket.id, scope, performedBy: { id: ticket.createdBy } };

    case TICKET_UPDATED_EVENT:
      // No real update happened, so there are no changes to report.
      return ticket && { ticketId: ticket.id, scope, changes: {}, performedBy: { id: null } };

    case EMAIL_RECEIVED_EVENT:
    case EMAIL_SENT_EVENT: {
      const types =
        resolveAs === EMAIL_RECEIVED_EVENT ? [EmailType.DEFAULT] : [EmailType.REPLY, EmailType.REPLY_ALL];
      const email = await findLatestEmail(conversationId, types);
      return email && { emailId: email.id, channelId: email.channelId };
    }

    case TICKET_COMMENTED_EVENT: {
      if (!ticket) return null;
      const message = await db.message.findFirst({
        where: {
          conversationId,
          msgType: MessageType.USER,
          isDeleted: false,
          visibleTo: null,
          isSent: true,
          messageId: { not: conversation.initialMessageId },
        },
        orderBy: [{ createdAt: 'desc' }, { messageId: 'desc' }],
      });
      return message && { ticketId: ticket.id, messageId: message.messageId, conversationId, authorId: message.senderId };
    }

    case MESSAGE_RECEIVED_EVENT: {
      const message = await db.message.findFirst({
        where: { messageId: conversation.initialMessageId, isDeleted: false },
      });
      return (
        message && {
          messageId: message.messageId,
          conversationId,
          channelId,
          authorId: message.senderId,
          msgType: message.msgType as MessageType,
        }
      );
    }

    case CALL_EVENT: {
      const call = conversation.callId ? await db.call.findUnique({ where: { id: conversation.callId } }) : null;
      return (
        call && {
          callEventType: call.endedAt ? CALL_ENDED : CALL_STARTED,
          callId: call.id,
          externalId: call.externalId,
          channelId: call.channelId,
          title: call.title,
          callType: call.callType as CallType,
          startedAt: call.startedAt,
          endedAt: call.endedAt,
          durationSeconds: call.endedAt
            ? Math.round((call.endedAt.getTime() - call.startedAt.getTime()) / 1000)
            : null,
          aiSummary: call.aiSummary,
          transcript: call.transcript,
          conversationId,
        }
      );
    }

    case TAG_GENERATED_EVENT: {
      const emails = await db.email.findMany({
        where: { conversationId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, channelId: true },
      });
      const tagged = await db.tag.findFirst({
        where: { sourceType: DESK_EMAIL_SOURCE_TYPE, sourceId: { in: emails.map(e => e.id) }, isDeleted: false },
        orderBy: { createdAt: 'desc' },
        select: { sourceId: true },
      });
      const email = emails.find(e => e.id === tagged?.sourceId);
      if (!email) return null;
      const tags = await tagService.listTags(email.id, DESK_EMAIL_SOURCE_TYPE);
      return {
        sourceId: email.id,
        sourceType: DESK_EMAIL_SOURCE_TYPE,
        channelId: email.channelId,
        tags: tags.map(t => ({ category: t.tagCategory, tag: t.tag, reason: t.reason ?? null })),
      };
    }
  }
}

function findLatestEmail(conversationId: string, types: EmailType[]) {
  return db.email.findFirst({
    where: { conversationId, type: { in: types } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, channelId: true },
  });
}

export const resolveConversationStep = new ResolveConversationStep();
