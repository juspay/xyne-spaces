import { z } from 'zod';
import { defineRequestContract, type RequestOf } from '../define.js';

/**
 * Zero mutator `delayedMessages.create` (schedule a message). The mutator only needs to know
 * whether the content is empty (a schedule with no text and no attachments is refused); the
 * text itself is read by the delivery worker, which is a direct consumer tracked separately.
 */
export const delayedMessagesCreateClient = defineRequestContract({
  encrypted: ['content'],
  derived: ['text'],
  schema: z.object({
    id: z.string(),
    channelId: z.string(),
    conversationId: z.string().optional(),
    content: z.string(),
    scheduledFor: z.number(),
    timestamp: z.number(),
  }),
});

export type DelayedMessagesCreateRequest = RequestOf<typeof delayedMessagesCreateClient>;

/** Zero mutator `delayedMessages.edit`: same facts as create. */
export const delayedMessagesEditClient = defineRequestContract({
  encrypted: ['content'],
  derived: ['text'],
  schema: z.object({
    id: z.string(),
    content: z.string(),
    updatedAt: z.number(),
  }),
});

export type DelayedMessagesEditRequest = RequestOf<typeof delayedMessagesEditClient>;
