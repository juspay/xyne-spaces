import { z } from 'zod';
import { defineRequestContract } from '../define.js';
import { derive } from '../extractors.js';
import { unreadableString } from '../unreadable-string.js';

/**
 * Zero mutator `draft.createAttachments`. The client encrypts the draft text (`content`); it is
 * stored as received. It lists one fact so that "no facts" means empty, which is how
 * `content || ''` and `content || existingDraft.content` are kept. The file names sit inside the
 * `attachments` array, which a contract cannot mark yet: they stay plaintext here.
 */
export const draftCreateAttachmentsClient = defineRequestContract({
  sourceToDerived: { content: { textLength: derive.textLength } },
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
    content: unreadableString().optional(),
    timestamp: z.number(),
  }),
});

/**
 * Zero mutators `activities.markThreadActivitiesAsReadV2` (thread) and
 * `channel.markChannelAsViewed` (channel) also save the user's draft. The client encrypts
 * `draftMessage`; it is stored as received. `textIsEmpty` decides between deleting the draft and
 * saving it (the old `draftMessage.trim() === ''` check); no facts means it was empty.
 */
export const markThreadActivitiesAsReadV2Client = defineRequestContract({
  sourceToDerived: { draftMessage: { textIsEmpty: derive.textIsEmpty } },
  schema: z.object({
    conversationId: z.string(),
    draftMessage: unreadableString(),
    draftMessageId: z.string(),
    timestamp: z.number(),
    participantId: z.string(),
  }),
});

export const markChannelAsViewedClient = defineRequestContract({
  sourceToDerived: { draftMessage: { textIsEmpty: derive.textIsEmpty } },
  schema: z.object({
    channelId: z.string(),
    conversationId: z.string().optional(),
    timestamp: z.number(),
    draftMessage: unreadableString().optional(),
    draftMessageId: z.string().optional(),
  }),
});
