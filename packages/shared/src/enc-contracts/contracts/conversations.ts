import { z } from 'zod';
import { MessageType } from '../../zero/types.js';
import { defineRequestContract, type RequestOf } from '../define.js';
import { derive } from '../extractors.js';
import { unreadableString } from '../unreadable-string.js';

/**
 * Conversation reply API; attached to its route in the backend's routes/conversations.ts.
 * Runs unencrypted for now (`sourceToDerived: {}`, manifest rule revision 2): clients without
 * transit encryption still post here, and the handler parses the plaintext. To re-enable,
 * list `content` here with the facts the handler reads and ship a rule revision with
 * `content.client = true`.
 */
export const replyToConversationClient = defineRequestContract({
  sourceToDerived: {},
  schema: z.object({
    content: unreadableString().optional(),
    msgType: z.enum([MessageType.USER, MessageType.BOT]).optional(),
    visibleTo: z.string().nullable().optional(),
    fileMetadata: z.string().optional(),
    showInChannel: z
      .union([z.boolean(), z.enum(['true', 'false']).transform(value => value === 'true')])
      .optional(),
  }),
});

export type ReplyToConversationRequest = RequestOf<typeof replyToConversationClient>;

/**
 * Zero mutator `conversations.send` (start a conversation); its args are this body. The
 * client encrypts `content`; the mutator gets workspace-DEK ciphertext and reads these facts
 * from `derived.fields.content`: mentions for the guest check and participants, Meet links,
 * the bot command. `mentionsChannel` / `mentionsHere`, `firstUrl` and `prLinks` are for the
 * message side effects (notifications, previews, PR approval button).
 */
export const conversationsSendClient = defineRequestContract({
  sourceToDerived: {
    content: {
      userIds: derive.userIds,
      groupIds: derive.groupIds,
      handles: derive.handles,
      mentionsChannel: derive.mentionsChannel,
      mentionsHere: derive.mentionsHere,
      firstUrl: derive.firstUrl,
      prLinks: derive.prLinks,
      meetLinks: derive.meetLinks,
      commandName: derive.commandName,
      commandArgs: derive.commandArgs,
    },
  },
  schema: z.object({
    channelId: z.string(),
    content: unreadableString(),
    conversationId: z.string(),
    messageId: z.string(),
    timestamp: z.number(),
    type: z.nativeEnum(MessageType),
    attachmentIds: z.array(z.string()).optional(),
    entityLinkContext: z.unknown().optional(),
  }),
});

export type ConversationsSendRequest = RequestOf<typeof conversationsSendClient>;

/**
 * Zero mutator `messages.send` (a reply in a thread); its args are this body. The client trims
 * and encrypts `content`; the mutator stores it as received and decides on these facts: mentions
 * for the guest check (`userIds`, `groupIds`, `handles`) and, by the participant rule, for who is
 * added (`spanMentionUserIds`, `spanMentionGroupIds`); Meet links; the slash-command artifact it
 * is, for the one-open-artifact-per-thread rule. No facts means the content was empty.
 */
export const messagesSendClient = defineRequestContract({
  sourceToDerived: {
    content: {
      userIds: derive.userIds,
      groupIds: derive.groupIds,
      handles: derive.handles,
      spanMentionUserIds: derive.spanMentionUserIds,
      spanMentionGroupIds: derive.spanMentionGroupIds,
      meetLinks: derive.meetLinks,
      slashArtifactCommand: derive.slashArtifactCommand,
    },
  },
  schema: z.object({
    conversationId: z.string(),
    content: unreadableString(),
    type: z.nativeEnum(MessageType),
    showInChannel: z.boolean().optional(),
    timestamp: z.number(),
    messageId: z.string(),
    childConversationId: z.string().optional(),
    attachmentIds: z.array(z.string()).optional(),
  }),
});

/**
 * Zero mutator `messages.update` (edit a message). The client encrypts `content`; it is stored as
 * received. For a forwarded message the client sends the whole forwarded XML with the new
 * optional text (`buildMessageEditContent`); the server checks its forwarded ids against the
 * stored message's. Mentions come by the participant rule: from the text, or for a forward from
 * its optional text. No facts means the content was empty.
 */
export const messagesUpdateClient = defineRequestContract({
  sourceToDerived: {
    content: {
      userIds: derive.userIds,
      groupIds: derive.groupIds,
      handles: derive.handles,
      spanMentionUserIds: derive.spanMentionUserIds,
      spanMentionGroupIds: derive.spanMentionGroupIds,
      forwardedOptionalTextUserIds: derive.forwardedOptionalTextUserIds,
      forwardedOptionalTextGroupIds: derive.forwardedOptionalTextGroupIds,
      forwardedMessageId: derive.forwardedMessageId,
      forwardedConversationId: derive.forwardedConversationId,
      forwardedSenderId: derive.forwardedSenderId,
      forwardedChannelId: derive.forwardedChannelId,
    },
  },
  schema: z.object({
    messageId: z.string(),
    content: unreadableString().optional(),
  }),
});

/**
 * Zero mutator `conversations.forwardMessage`. The client builds the forward's XML
 * (`buildForwardedMessageContent`, it holds the original's text) and encrypts it as `content`;
 * it is stored as received. The server checks the forwarded ids against the original message and
 * the optional text's length on these facts. `optionalMessage` is the older arg, no longer used.
 */
export const conversationsForwardMessageClient = defineRequestContract({
  sourceToDerived: {
    content: {
      forwardedMessageId: derive.forwardedMessageId,
      forwardedConversationId: derive.forwardedConversationId,
      forwardedSenderId: derive.forwardedSenderId,
      forwardedChannelId: derive.forwardedChannelId,
      forwardedOptionalTextLength: derive.forwardedOptionalTextLength,
    },
  },
  schema: z.object({
    targetChannelId: z.string(),
    originalMessageId: z.string(),
    content: unreadableString().optional(),
    optionalMessage: z.string().optional(),
    conversationId: z.string(),
    messageId: z.string(),
    timestamp: z.number(),
    conversationParticipantId: z.string(),
  }),
});
