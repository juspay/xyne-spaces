import { z } from 'zod';
import { MessageType } from '../../zero/types.js';
import { defineRequestContract } from '../define.js';

/** Body of the conversation reply API; attached to its route in the backend's routes/conversations.ts. */
export const replyToConversation = defineRequestContract({
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
