import { z } from 'zod';
import { defineRequestContract } from '../define.js';
import { derive } from '../extractors.js';
import { unreadableString } from '../unreadable-string.js';

/**
 * Zero mutators `delayedMessages.create` / `edit` (schedule a message, edit it while pending)
 * and `draftMessages.edit`. The client trims and encrypts `content`; it is stored as received.
 * `create` decides "is it empty" on `textIsEmpty` (the trimmed-text check it had).
 */
export const delayedMessagesCreateClient = defineRequestContract({
  sourceToDerived: { content: { textIsEmpty: derive.textIsEmpty } },
  schema: z.object({
    id: z.string(),
    channelId: z.string(),
    conversationId: z.string().optional(),
    content: unreadableString(),
    scheduledFor: z.number(),
    timestamp: z.number(),
  }),
});

export const delayedMessagesEditClient = defineRequestContract({
  sourceToDerived: { content: {} },
  schema: z.object({
    id: z.string(),
    content: unreadableString(z.string().min(1)),
    updatedAt: z.number(),
  }),
});

export const draftMessagesEditClient = defineRequestContract({
  sourceToDerived: { content: {} },
  schema: z.object({
    id: z.string(),
    content: unreadableString(z.string().min(1)),
    timestamp: z.number(),
  }),
});
