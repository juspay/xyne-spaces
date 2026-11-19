import { z } from 'zod';
import { MessageType } from '../../zero/types.js';
import { defineRequestContract, type RequestOf } from '../define.js';
import { derive, pick } from '../extractors.js';

/**
 * Conversation reply API; attached to its route in the backend's routes/conversations.ts.
 * Runs unencrypted for now (`sourceToDerived: {}`, manifest rule revision 2): clients without
 * transit encryption still post here, and the handler parses the plaintext. To re-enable,
 * list `content` here with the facts the handler reads (mentions, links, command, text) and
 * ship a rule revision with `content.client = true`.
 */
export const replyToConversationClient = defineRequestContract({
  sourceToDerived: {},
  schema: z.object({
    content: z.string().optional(),
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
 * client encrypts `content`; the mutator gets workspace-DEK ciphertext and reads the picked
 * mention, link and command facts from `derived.fields.content`. The mention flags and
 * `links.first` / `pr` are for the message side effects (notifications, previews).
 */
export const conversationsSendClient = defineRequestContract({
  sourceToDerived: {
    content: {
      mentions: pick(derive.mentions, 'userIds', 'groupIds', 'handles', 'channel', 'here'),
      links: pick(derive.links, 'first', 'pr', 'meet'),
      command: pick(derive.command, 'name', 'args'),
    },
  },
  schema: z.object({
    channelId: z.string(),
    content: z.string(),
    conversationId: z.string(),
    messageId: z.string(),
    timestamp: z.number(),
    type: z.nativeEnum(MessageType),
    attachmentIds: z.array(z.string()).optional(),
    entityLinkContext: z.unknown().optional(),
  }),
});

export type ConversationsSendRequest = RequestOf<typeof conversationsSendClient>;
