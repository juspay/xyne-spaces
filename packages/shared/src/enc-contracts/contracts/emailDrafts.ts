import { z } from 'zod';
import { defineRequestContract } from '../define.js';
import { unreadableString } from '../unreadable-string.js';

/**
 * Zero mutators `emailDraft.upsert` (reply draft) and `emailDraft.upsertComposeDraft` (new
 * email). The client encrypts `draftContent` (and `subject`); they are stored as received.
 */
export const emailDraftUpsertClient = defineRequestContract({
  sourceToDerived: { draftContent: {} },
  schema: z.object({
    id: z.string(),
    conversationId: z.string(),
    channelId: z.string(),
    draftContent: unreadableString().optional(),
    attachmentIds: z.array(z.string()).optional(),
    toRecipients: z.array(z.string()).optional(),
    ccRecipients: z.array(z.string()).optional(),
    bccRecipients: z.array(z.string()).optional(),
    updatedAt: z.number(),
  }),
});

export const emailDraftUpsertComposeDraftClient = defineRequestContract({
  sourceToDerived: { subject: {}, draftContent: {} },
  schema: z.object({
    id: z.string(),
    channelId: z.string(),
    subject: unreadableString().optional(),
    fromAddress: z.string().optional(),
    draftContent: unreadableString().optional(),
    attachmentIds: z.array(z.string()).optional(),
    toRecipients: z.array(z.string()).optional(),
    ccRecipients: z.array(z.string()).optional(),
    bccRecipients: z.array(z.string()).optional(),
    updatedAt: z.number(),
  }),
});
