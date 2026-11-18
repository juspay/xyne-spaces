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
 * ciphertext and reads mentions, links, the bot command and the length from `derived`.
 */
export const conversationsSendClient = defineRequestContract({
  encrypted: ['content'],
  derived: ['mentions', 'links', 'command', 'text'],
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

/**
 * Zero mutator `messages.send` (reply in a thread). Same facts as conversations.send plus the
 * slash-command artifact: the mutator checks guest mentions, adds mentioned participants,
 * records Meet links, hands the bot command on and enforces one open artifact per thread, all
 * from `derived`, never from the content.
 */
export const messagesSendClient = defineRequestContract({
  encrypted: ['content'],
  derived: ['mentions', 'links', 'command', 'text', 'artifact'],
  schema: z.object({
    conversationId: z.string(),
    content: z.string(),
    type: z.nativeEnum(MessageType),
    showInChannel: z.boolean().optional(),
    timestamp: z.number(),
    messageId: z.string(),
    childConversationId: z.string().optional(),
    attachmentIds: z.array(z.string()).optional(),
  }),
});

export type MessagesSendRequest = RequestOf<typeof messagesSendClient>;

/**
 * Zero mutator `messages.update` (edit). `content` is optional (metadata-only edits). The
 * mutator checks guest mentions and adds newly mentioned participants from `derived.mentions`;
 * it no longer removes participants who stopped being mentioned, since the previous content is
 * ciphertext it cannot compare against.
 */
export const messagesUpdateClient = defineRequestContract({
  encrypted: ['content'],
  derived: ['mentions', 'text'],
  schema: z.object({
    messageId: z.string(),
    content: z.string().optional(),
  }),
});

export type MessagesUpdateRequest = RequestOf<typeof messagesUpdateClient>;

/**
 * Zero mutator `messages.closeSlashCommandArtifact`. `content` is the artifact message already
 * rewritten as closed by the client (the server cannot rewrite ciphertext); nothing is derived,
 * the server only re-keys it to the workspace DEK and stores it.
 */
export const messagesCloseSlashCommandArtifactClient = defineRequestContract({
  encrypted: ['content'],
  derived: [],
  schema: z.object({
    messageId: z.string(),
    timestamp: z.number(),
    content: z.string(),
  }),
});

export type MessagesCloseSlashCommandArtifactRequest = RequestOf<typeof messagesCloseSlashCommandArtifactClient>;
