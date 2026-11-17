import { z } from 'zod';
import { MessageType } from '../../zero/types.js';
import { defineRequestContract, type RequestOf } from '../define.js';

/**
 * Conversation reply API; attached to its route in the backend's routes/conversations.ts.
 * `encrypted` names the fields the client sends as ciphertext; `derived` the facts the
 * handler reads instead of that plaintext (mentions to notify, links for previews, the bot
 * command, the plaintext length). Runs unencrypted for now (`encrypted: []`, manifest rule
 * revision 2): clients without transit encryption still post here. To re-enable, list
 * `content` here and ship a rule revision with `content.client = true`.
 */
export const replyToConversationClient = defineRequestContract({
  encrypted: [],
  derived: ['mentions', 'links', 'command', 'text'],
  derivedFrom: 'content',
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
 * client encrypts `content` under its transit ticket; the mutator gets workspace-DEK
 * ciphertext and reads mentions, links, the bot command and the length from `derived`
 * (extracted by the backend from `content` when it arrives as plaintext).
 */
export const conversationsSendClient = defineRequestContract({
  encrypted: ['content'],
  derived: ['mentions', 'links', 'command', 'text'],
  derivedFrom: 'content',
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
