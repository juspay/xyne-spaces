import { z } from 'zod';
import { MessageType } from '@prisma/client';
import { BaseTrigger } from './base-trigger';
import { TriggerCategory } from '../types/categories';
import { eventRouter } from '../engine/event-router';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import {
  MembershipSchema,
  TicketContextSchema,
  buildTicketContext,
  getChannelMembership,
  matchTicketScopeFilters,
} from './ticket-context';
import type { TicketCommentedEventPayload } from '../types/automation-events';

export const TICKET_COMMENTED_EVENT = 'TICKET_COMMENTED';

const TicketCommentedConfigSchema = z.object({
  boardIds: z
    .array(z.string())
    .optional()
    .describe('Limit to tickets on these boards. Empty matches every board.'),
  channelIds: z
    .array(z.string())
    .optional()
    .describe('Limit to tickets posted to these channels. Empty matches every channel.'),
  projectIds: z
    .array(z.string())
    .optional()
    .describe('Limit to tickets on these projects. Empty matches every project.'),
  contentContains: z
    .string()
    .optional()
    .describe('Case-insensitive substring of the message body. Empty matches any comment.'),
  fromUserIds: z
    .array(z.string())
    .optional()
    .describe('Only fire when the comment author is one of these users. Empty matches anyone.'),
  performedByMembership: z
    .array(MembershipSchema)
    .optional()
    .describe(
      'Filter by whether the poster is a channel MEMBER (team-side participant) or EXTERNAL (not in the channel). Empty matches both.',
    ),
});

export const TicketCommentedOutputSchema = TicketContextSchema.extend({
  message: z.object({
    id: z.string(),
    content: z.string().nullable(),
    conversationId: z.string(),
    channelId: z.string(),
    createdAt: z.coerce.date(),
  }),
  author: z
    .object({
      id: z.string(),
      name: z.string().nullable(),
      email: z.string().nullable(),
    })
    .nullable(),
  authorId: z.string(),
  performedBy: z.object({
    id: z.string().nullable(),
    membership: MembershipSchema,
  }),
});

type TicketCommentedConfig = z.infer<typeof TicketCommentedConfigSchema>;
type TicketCommentedPayload = z.infer<typeof TicketCommentedOutputSchema>;

export class TicketCommentedTrigger extends BaseTrigger<typeof TicketCommentedConfigSchema> {
  readonly type = TICKET_COMMENTED_EVENT;
  readonly configSchema = TicketCommentedConfigSchema;
  readonly outputSchema = TicketCommentedOutputSchema;
  readonly name = 'When a ticket is commented';
  readonly description =
    'Fires when a person posts a message in a ticket conversation. Filter by board, channel, project, author, or text in the comment.';
  readonly category = TriggerCategory.EVENT;
  readonly icon = 'MessageSquare';

  async hydratePayload(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return hydrateTicketCommentedPayload(payload as unknown as TicketCommentedEventPayload);
  }

  override matchFilters(
    filter: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): boolean {
    const cfg = filter as TicketCommentedConfig;
    const p = payload as TicketCommentedPayload;
    const t = p.ticket;

    if (!matchTicketScopeFilters(cfg, t)) return false;
    if (cfg.contentContains && cfg.contentContains.length > 0) {
      if (!p.message.content) return false;
      if (!p.message.content.toLowerCase().includes(cfg.contentContains.toLowerCase())) return false;
    }
    const fromUserIds = (cfg.fromUserIds ?? [])
      .map(id => id?.trim())
      .filter((id): id is string => !!id);
    if (fromUserIds.length > 0) {
      if (!fromUserIds.includes(p.authorId)) return false;
    }
    if (cfg.performedByMembership && cfg.performedByMembership.length > 0) {
      if (!cfg.performedByMembership.includes(p.performedBy.membership)) return false;
    }
    return true;
  }
}

export const ticketCommentedTrigger = new TicketCommentedTrigger();

interface AddedMessage {
  messageId: string;
  conversationId: string;
  content?: string | undefined;
  msgType?: MessageType | undefined;
  isBot?: boolean | undefined;
  userId: string;
  createdAt?: Date | undefined;
}

export async function emitTicketCommented(message: AddedMessage): Promise<void> {
  try {
    if (message.isBot) return;
    if (message.msgType !== undefined && message.msgType !== MessageType.USER) return;

    const ticketStub = await repositories.tickets.findFirstByConversationId(message.conversationId);
    if (!ticketStub) return;

    await eventRouter.emit(
      {
        type: TICKET_COMMENTED_EVENT,
        payload: {
          ticketId: ticketStub.id,
          messageId: message.messageId,
          conversationId: message.conversationId,
          authorId: message.userId,
        },
      },
      ticketStub.workspaceId,
    );
  } catch (err) {
    logger.error('[automations] emitTicketCommented failed', {
      messageId: message.messageId,
      error: err,
    });
  }
}

async function hydrateTicketCommentedPayload(
  payload: TicketCommentedEventPayload,
): Promise<Record<string, unknown>> {
  const { ticketId, messageId, conversationId, authorId } = payload;

  const ticket = await repositories.tickets.getTicketById(ticketId).catch(() => null);
  if (!ticket) return { ...payload };

  const channelId =
    ticket.channelId ??
    (conversationId
      ? (await repositories.conversations.findById(conversationId))?.channelId ?? null
      : null);
  if (!channelId) return { ...payload };

  const [context, messageRow, authorUser] = await Promise.all([
    buildTicketContext(ticket),
    db.message.findUnique({ where: { messageId } }).catch(() => null),
    repositories.users.findById(authorId).catch(() => null),
  ]);

  return {
    ...payload,
    ...context,
    message: {
      id: messageId,
      content: messageRow?.content ?? null,
      conversationId,
      channelId,
      createdAt: messageRow?.createdAt ?? new Date(),
    },
    author: authorUser
      ? {
          id: authorUser.id,
          name: authorUser.name ?? null,
          email: authorUser.email ?? null,
        }
      : null,
    authorId,
    performedBy: {
      id: authorId,
      membership: await getChannelMembership(channelId, authorId),
    },
  };
}
