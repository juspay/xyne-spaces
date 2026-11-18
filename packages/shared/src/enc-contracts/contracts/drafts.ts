import { z } from 'zod';
import { defineRequestContract, type RequestOf } from '../define.js';

/**
 * Draft mutators. The draft text is stored as sent; the only server decision is "is it blank",
 * which comes from the text fact. The text itself is read when the draft is sent
 * (deliverDraftServerMessage), a direct consumer tracked separately.
 */
export const draftCreateAttachmentsClient = defineRequestContract({
  encrypted: ['content'],
  derived: [],
  schema: z.object({
    draftMessageId: z.string(),
    attachments: z.array(
      z.object({
        attachmentId: z.string(),
        originalFilename: z.string(),
        mimetype: z.string(),
        size: z.number(),
        width: z.number().optional(),
        height: z.number().optional(),
      }),
    ),
    channelId: z.string(),
    conversationId: z.string().optional(),
    content: z.string().optional(),
    timestamp: z.number(),
  }),
});

export type DraftCreateAttachmentsRequest = RequestOf<typeof draftCreateAttachmentsClient>;

export const channelMarkChannelAsViewedClient = defineRequestContract({
  encrypted: ['draftMessage'],
  derived: ['text'],
  schema: z.object({
    channelId: z.string(),
    conversationId: z.string().optional(),
    timestamp: z.number(),
    draftMessage: z.string().optional(),
    draftMessageId: z.string().optional(),
  }),
});

export type ChannelMarkChannelAsViewedRequest = RequestOf<typeof channelMarkChannelAsViewedClient>;

export const activitiesMarkThreadActivitiesAsReadClient = defineRequestContract({
  encrypted: ['draftMessage'],
  derived: ['text'],
  schema: z.object({
    conversationId: z.string(),
    draftMessage: z.string(),
    draftMessageId: z.string(),
    timestamp: z.number(),
  }),
});

export type ActivitiesMarkThreadActivitiesAsReadRequest = RequestOf<typeof activitiesMarkThreadActivitiesAsReadClient>;

export const activitiesMarkThreadActivitiesAsReadV2Client = defineRequestContract({
  encrypted: ['draftMessage'],
  derived: ['text'],
  schema: z.object({
    conversationId: z.string(),
    draftMessage: z.string(),
    draftMessageId: z.string(),
    timestamp: z.number(),
    participantId: z.string(),
  }),
});

export type ActivitiesMarkThreadActivitiesAsReadV2Request = RequestOf<typeof activitiesMarkThreadActivitiesAsReadV2Client>;

export const draftMessagesEditClient = defineRequestContract({
  encrypted: ['content'],
  derived: ['text'],
  schema: z.object({
    id: z.string(),
    content: z.string(),
    timestamp: z.number(),
  }),
});

export type DraftMessagesEditRequest = RequestOf<typeof draftMessagesEditClient>;
