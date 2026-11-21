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
