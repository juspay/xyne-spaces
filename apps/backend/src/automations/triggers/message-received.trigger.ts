import { z } from 'zod';
import { MessageType } from '@xyne/shared';
import { BaseTrigger } from './base-trigger';
import { TriggerCategory } from '../types/categories';
import { eventRouter } from '../engine/event-router';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { extractGroupMentions, extractUserMentions } from '@/utils/mentionParser';
import { toReadableMessageContent } from '@/utils/flowJson';
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
  mentionedUserIds: z
    .array(z.string())
    .optional()
    .describe('Only fire when at least one of these users is mentioned. Empty matches any mention; omit entirely to not filter on mentions.'),
  mentionedGroupIds: z
    .array(z.string())
    .optional()
    .describe('Only fire when at least one of these user groups is mentioned. Empty matches any group mention; omit entirely to not filter on group mentions.'),
  fireOnEdit: z
    .boolean()
    .default(false)
    .describe(
      'Also fire when an existing message is edited into a match — e.g. an alert card whose status field is rewritten in place. Only the transition fires: an edit that leaves an already-matching message still matching is ignored. Needs a Content Contains value to be meaningful.',
    ),
});

export const MessageReceivedOutputSchema = z.object({
  message: z.object({
    id: z.string(),
    content: z.string().nullable(),
    rawContent: z.string().nullable(),
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
  isEdit: z.boolean().optional(),
  previousContentMatched: z.boolean().optional(),
  mentionedUsers: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().nullable(),
        email: z.string().nullable(),
      }),
    )
    .optional(),
  mentionedUserIds: z.array(z.string()).optional(),
  mentionedUserNames: z.string().optional(),
  hasMention: z.boolean().optional(),
  mentionedGroups: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().nullable(),
        alias: z.string().nullable(),
      }),
    )
    .optional(),
  mentionedGroupIds: z.array(z.string()).optional(),
  mentionedGroupNames: z.string().optional(),
  hasGroupMention: z.boolean().optional(),
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

  /**
   * Drop the pre-edit body and keep only whether it already satisfied this
   * automation's content filter. The body itself is never persisted or logged.
   */
  override projectPayload(
    config: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const { previousContent, ...rest } = payload as { previousContent?: string };
    if (previousContent === undefined) return rest;
    const needle = (config as MessageReceivedConfig).contentContains;
    return {
      ...rest,
      previousContentMatched: !!needle && previousContent.toLowerCase().includes(needle.toLowerCase()),
    };
  }

  override matchFilters(
    filter: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): boolean {
    const cfg = filter as MessageReceivedConfig;
    const p = payload as MessageReceivedPayload;

    // The message was deleted before we got to run — nothing to act on.
    if (p.deleted) return false;
    // Edits reach every candidate; only automations that opted in act on them.
    if (p.isEdit && !cfg.fireOnEdit) return false;
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
    // Match filters: contentContains, user mentions, group mentions.
    // These combine with OR logic when multiple are configured:
    // if ANY of the configured match conditions is satisfied, the trigger fires.
    //
    // Mention filters use `undefined` vs `[]` deliberately:
    //   - undefined  -> the filter was not configured, so it imposes no condition
    //   - []         -> explicitly "any mention"; the message must contain at least one mention
    //   - [ids...]   -> the message must mention at least one of the listed users/groups
    const contentFilterConfigured = cfg.contentContains && cfg.contentContains.length > 0;
    const userMentionFilterConfigured = cfg.mentionedUserIds !== undefined;
    const groupMentionFilterConfigured = cfg.mentionedGroupIds !== undefined;

    if (contentFilterConfigured || userMentionFilterConfigured || groupMentionFilterConfigured) {
      const matchResults: boolean[] = [];

      if (contentFilterConfigured) {
        // Decoded text and the stored blob: a filter written against a FlowJSON
        // card title or button label must keep firing after the decode.
        const needle = cfg.contentContains!.toLowerCase();
        const nowMatches = [p.message.content, p.message.rawContent]
          .some(text => !!text && text.toLowerCase().includes(needle));
        // On an edit only the transition counts — an edit that leaves an
        // already-matching message still matching must not re-run the automation.
        const contentPasses = p.isEdit ? nowMatches && !p.previousContentMatched : nowMatches;
        matchResults.push(contentPasses);
      }

      if (userMentionFilterConfigured) {
        const explicitMentionedUserIds = cfg.mentionedUserIds!
          .map(id => id?.trim())
          .filter((id): id is string => !!id);

        let userMentionPasses: boolean;
        if (explicitMentionedUserIds.length === 0) {
          // Empty configured list means "any user mention", not "no filter".
          userMentionPasses = !!p.hasMention;
        } else {
          const messageMentionedIds = p.mentionedUserIds ?? [];
          userMentionPasses = explicitMentionedUserIds.some(id => messageMentionedIds.includes(id));
        }
        matchResults.push(userMentionPasses);
      }

      if (groupMentionFilterConfigured) {
        const explicitMentionedGroupIds = cfg.mentionedGroupIds!
          .map(id => id?.trim())
          .filter((id): id is string => !!id);

        let groupMentionPasses: boolean;
        if (explicitMentionedGroupIds.length === 0) {
          // Empty configured list means "any group mention", not "no filter".
          groupMentionPasses = !!p.hasGroupMention;
        } else {
          const messageMentionedGroupIds = p.mentionedGroupIds ?? [];
          groupMentionPasses = explicitMentionedGroupIds.some(id => messageMentionedGroupIds.includes(id));
        }
        matchResults.push(groupMentionPasses);
      }

      // At least one configured match filter must pass (OR logic)
      if (!matchResults.some(Boolean)) return false;
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
  isEdit?: boolean;
  previousContent?: string;
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
          ...(message.isEdit ? { isEdit: true } : {}),
          ...(message.previousContent !== undefined
            ? { previousContent: message.previousContent }
            : {}),
        },
      },
      channel.workspaceId,
    );
  } catch (err) {
    logger.error('[automations] emitMessageReceived failed', {
      messageId: message.messageId,
      error: err,
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

  let mentionedUserIds: string[] = [];
  let mentionedUsers: Array<{ id: string; name: string | null; email: string | null }> = [];
  let mentionedUserNames: string | undefined;
  let hasMention = false;

  let mentionedGroupIds: string[] = [];
  let mentionedGroups: Array<{ id: string; name: string | null; alias: string | null }> = [];
  let mentionedGroupNames: string | undefined;
  let hasGroupMention = false;

  if (messageRow?.content) {
    mentionedUserIds = extractUserMentions(messageRow.content);

    if (mentionedUserIds.length > 0) {
      hasMention = true;
      const mentionedUsersData = await db.user.findMany({
        where: { id: { in: mentionedUserIds } },
        select: { id: true, name: true, email: true },
      });
      const usersById = new Map(mentionedUsersData.map(u => [u.id, u]));
      mentionedUsers = mentionedUserIds.flatMap(id => {
        const user = usersById.get(id);
        return user ? [{ id: user.id, name: user.name ?? null, email: user.email ?? null }] : [];
      });
      mentionedUserNames = mentionedUsers
        .map(u => u.name)
        .filter((n): n is string => !!n)
        .join(', ');
    }

    mentionedGroupIds = extractGroupMentions(messageRow.content);

    if (mentionedGroupIds.length > 0) {
      hasGroupMention = true;
      const mentionedGroupsData = await db.userGroup.findMany({
        where: { id: { in: mentionedGroupIds } },
        select: { id: true, name: true, alias: true },
      });
      const groupsById = new Map(mentionedGroupsData.map(g => [g.id, g]));
      mentionedGroups = mentionedGroupIds.flatMap(id => {
        const group = groupsById.get(id);
        return group ? [{ id: group.id, name: group.name ?? null, alias: group.alias ?? null }] : [];
      });
      mentionedGroupNames = mentionedGroups
        .map(g => g.name)
        .filter((n): n is string => !!n)
        .join(', ');
    }
  }

  return {
    ...payload,
    message: {
      id: messageId,
      content: toReadableMessageContent(messageRow?.content),
      rawContent: messageRow?.content ?? null,
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
    mentionedUsers: mentionedUsers.length > 0 ? mentionedUsers : undefined,
    mentionedUserIds: mentionedUserIds.length > 0 ? mentionedUserIds : undefined,
    mentionedUserNames,
    hasMention,
    mentionedGroups: mentionedGroups.length > 0 ? mentionedGroups : undefined,
    mentionedGroupIds: mentionedGroupIds.length > 0 ? mentionedGroupIds : undefined,
    mentionedGroupNames,
    hasGroupMention,
  };
}
