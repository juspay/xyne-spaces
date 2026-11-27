import { z } from 'zod';
import { MessageType } from '@xyne/shared';
import { defineRequestContract, type RequestOf } from '../define.js';

/**
 * Conversation reply API; attached to its route in the backend's routes/conversations.ts.
 * Runs unencrypted for now (manifest rule revision 3 lists every field as plaintext): clients
 * without transit encryption still post here, and the handler reads `content` as a plain string.
 * To encrypt it, make `content` `unreadableString()` with the facts the handler decides on in
 * `sourceToDerived`, and ship a rule revision that leaves it out of the plaintext list.
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

