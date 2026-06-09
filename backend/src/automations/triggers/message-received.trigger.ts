import { z } from 'zod';
import { MessageType } from '@prisma/client';
import { BaseTrigger } from './base-trigger';
import { TriggerCategory } from '../types/categories';
import { eventRouter } from '../engine/event-router';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import type { MessageReceivedEventPayload } from '../types/automation-events';

export const MESSAGE_RECEIVED_EVENT = 'MESSAGE_RECEIVED';

const MessageReceivedConfigSchema = z.object({
  channelIds: z
    .array(z.string())
    .optional()
    .describe('Limit to messages in these channels. Empty matches every channel.'),
  fromUserIds: z
    .array(z.string())
    .optional()
    .describe('Only fire when the sender is one of these users. Empty matches anyone.'),
  contentContains: z
    .string()
    .optional()
    .describe('Case-insensitive substring of the message body. Empty matches any message.'),
  messageTypes: z
    .array(z.nativeEnum(MessageType))
    .default([MessageType.USER])
    .describe(
      'Message kinds that fire this trigger. Defaults to messages from people (USER); add BOT, SYSTEM, or FORWARDED to include those, or clear it to match every kind.',
    ),
});

export const MessageReceivedOutputSchema = z.object({
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
  channelId: z.string(),
  conversationId: z.string(),
  msgType: z.nativeEnum(MessageType),
  deleted: z.boolean(),
});

type MessageReceivedConfig = z.infer<typeof MessageReceivedConfigSchema>;
type MessageReceivedPayload = z.infer<typeof MessageReceivedOutputSchema>;

export class MessageReceivedTrigger extends BaseTrigger<typeof MessageReceivedConfigSchema> {
  readonly type = MESSAGE_RECEIVED_EVENT;
  readonly configSchema = MessageReceivedConfigSchema;
  readonly outputSchema = MessageReceivedOutputSchema;
  readonly name = 'When a message is received in a channel';
  readonly description =
    'Fires when a person starts a new message in a channel (not replies within an existing conversation). Scope by channel or sender; optionally refine by message kind or text.';
  readonly category = TriggerCategory.EVENT;
  readonly icon = 'MessageSquare';
  readonly scopeFilterFields = ['channelIds', 'fromUserIds'] as const;

  async hydratePayload(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return hydrateMessageReceivedPayload(payload as unknown as MessageReceivedEventPayload);
  }

  override matchFilters(
    filter: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): boolean {
    const cfg = filter as MessageReceivedConfig;
    const p = payload as MessageReceivedPayload;

    // The message was deleted before we got to run — nothing to act on.
    if (p.deleted) return false;
    if (cfg.messageTypes && cfg.messageTypes.length > 0) {
      if (!cfg.messageTypes.includes(p.msgType)) return false;
    }

    const channelIds = (cfg.channelIds ?? []).map(id => id?.trim()).filter((id): id is string => !!id);
    const fromUserIds = (cfg.fromUserIds ?? []).map(id => id?.trim()).filter((id): id is string => !!id);
    if (channelIds.length > 0) {
      if (!channelIds.includes(p.channelId)) return false;
    }
    if (fromUserIds.length > 0) {
      if (!fromUserIds.includes(p.authorId)) return false;
    }
    if (cfg.contentContains && cfg.contentContains.length > 0) {
      if (!p.message.content) return false;
      if (!p.message.content.toLowerCase().includes(cfg.contentContains.toLowerCase())) return false;
    }
    return true;
  }
}

export const messageReceivedTrigger = new MessageReceivedTrigger();

interface ReceivedMessage {
  messageId: string;
  conversationId: string;
  channelId: string;
  msgType?: MessageType | undefined;
  userId: string;
}

/**
 * Fan out the `MESSAGE_RECEIVED` automation event. Fire-and-forget; resolves the
 * workspace from the channel. Failures are logged and must not fail the message
 * write.
 */
export async function emitMessageReceived(message: ReceivedMessage): Promise<void> {
  try {
    // No message-kind or bot filtering here — which kinds fire is a
    // user-configured trigger condition (`messageTypes`). Loops are prevented by
    // the run chain (the worker cancels an execution whose automation is already
    // upstream), so bot/self messages are safe to fan out.
    const channel = await repositories.channels.findById(message.channelId).catch(() => null);
    if (!channel?.workspaceId) return;

    await eventRouter.emit(
      {
        type: MESSAGE_RECEIVED_EVENT,
        payload: {
          messageId: message.messageId,
          conversationId: message.conversationId,
          channelId: message.channelId,
          authorId: message.userId,
          msgType: message.msgType ?? MessageType.USER,
        },
      },
      channel.workspaceId,
    );
  } catch (err) {
    logger.error('[automations] emitMessageReceived failed', {
      messageId: message.messageId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function hydrateMessageReceivedPayload(
  payload: MessageReceivedEventPayload,
): Promise<Record<string, unknown>> {
  const { messageId, conversationId, channelId, authorId } = payload;

  const [messageRow, authorUser] = await Promise.all([
    db.message.findUnique({ where: { messageId } }).catch(() => null),
    repositories.users.findById(authorId).catch(() => null),
  ]);

  return {
    ...payload,
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
    channelId,
    conversationId,
    msgType: payload.msgType,
    deleted: !messageRow,
  };
}
