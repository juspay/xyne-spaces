import { z } from 'zod';
import { MessageType } from '../../zero/types.js';
import { defineRequestContract, type RequestOf } from '../define.js';
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

