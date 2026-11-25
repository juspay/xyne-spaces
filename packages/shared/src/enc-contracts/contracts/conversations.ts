import { z } from 'zod';
import { MessageType } from '../../zero/types.js';
import { defineRequestContract, type RequestOf } from '../define.js';
import { derive } from '../extractors.js';
import { unreadableString } from '../unreadable-string.js';

/**
 * Conversation reply API; attached to its route in the backend's routes/conversations.ts.
 * The client encrypts `content` (manifest version 3, rule revision 1: `content.client = true`).
 * The handler stores it as received and decides on these facts instead of the text: the
 * visible length for the length limit, the bot command, and Meet links for call detection.
 */
export const replyToConversationClient = defineRequestContract({
  sourceToDerived: {
    content: {
      textLength: derive.textLength,
      isBotCommand: derive.isBotCommand,
      commandName: derive.commandName,
      commandArgs: derive.commandArgs,
      meetLinks: derive.meetLinks,
    },
  },
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
 * received. For a forwarded message `content` is only the new optional text: the server builds
 * the edited forward from the stored one (`forwardedMessageEditTemplate`), so an edit cannot
 * change what the forward quotes. Mentions come by the participant rule from the text. No facts
 * means the content was empty. `forwardedMessageId` is set only when the text is itself a forward's
 * XML: an older client sending the whole forward, which is refused.
 */
export const messagesUpdateClient = defineRequestContract({
  sourceToDerived: {
    content: {
      userIds: derive.userIds,
      groupIds: derive.groupIds,
      handles: derive.handles,
      spanMentionUserIds: derive.spanMentionUserIds,
      spanMentionGroupIds: derive.spanMentionGroupIds,
      forwardedMessageId: derive.forwardedMessageId,
    },
  },
  schema: z.object({
    messageId: z.string(),
    content: unreadableString().optional(),
  }),
});

/**
 * Zero mutator `conversations.forwardMessage`. The client sends only what the forwarder wrote,
 * `optionalMessage`, encrypted; the server builds the forward's XML from the original message it
 * reads itself (`forwardedMessageTemplate`, composed by the encryption service), so nothing of the
 * original comes from the client. The optional text's stored length (the old zod `.max(10000)`)
 * is checked on its `rawLength` fact.
 */
export const conversationsForwardMessageClient = defineRequestContract({
  sourceToDerived: {
    optionalMessage: { rawLength: derive.rawLength },
  },
  schema: z.object({
    targetChannelId: z.string(),
    originalMessageId: z.string(),
    optionalMessage: unreadableString().optional(),
    conversationId: z.string(),
    messageId: z.string(),
    timestamp: z.number(),
    conversationParticipantId: z.string(),
  }),
});
