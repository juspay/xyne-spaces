import { z } from 'zod';
import { defineRequestContract, type RequestOf } from '../define.js';

/**
 * Email mutators. Every text field is stored as sent; the mutators derive nothing from it.
 * Direct consumers tracked separately: the send path copies the draft into an outbound email,
 * and the classification workers substitute the inbound mail into the prompts.
 */
export const emailDraftUpsertClient = defineRequestContract({
  encrypted: ['draftContent'],
  derived: [],
  schema: z.object({
    id: z.string(),
    conversationId: z.string(),
    channelId: z.string(),
    draftContent: z.string().optional(),
    attachmentIds: z.array(z.string()).optional(),
    toRecipients: z.array(z.string()).optional(),
    ccRecipients: z.array(z.string()).optional(),
    bccRecipients: z.array(z.string()).optional(),
    updatedAt: z.number(),
  }),
});

export type EmailDraftUpsertRequest = RequestOf<typeof emailDraftUpsertClient>;

export const emailDraftUpsertComposeDraftClient = defineRequestContract({
  encrypted: ['subject', 'draftContent'],
  derived: [],
  schema: z.object({
    id: z.string(),
    channelId: z.string(),
    subject: z.string().optional(),
    fromAddress: z.string().optional(),
    draftContent: z.string().optional(),
    attachmentIds: z.array(z.string()).optional(),
    toRecipients: z.array(z.string()).optional(),
    ccRecipients: z.array(z.string()).optional(),
    bccRecipients: z.array(z.string()).optional(),
    updatedAt: z.number(),
  }),
});

export type EmailDraftUpsertComposeDraftRequest = RequestOf<typeof emailDraftUpsertComposeDraftClient>;

export const emailSignatureCreateClient = defineRequestContract({
  encrypted: ['content'],
  derived: [],
  schema: z.object({
    id: z.string(),
    name: z.string(),
    content: z.string(),
    timestamp: z.number(),
  }),
});

export type EmailSignatureCreateRequest = RequestOf<typeof emailSignatureCreateClient>;

export const emailSignatureUpdateClient = defineRequestContract({
  encrypted: ['content'],
  derived: [],
  schema: z.object({
    id: z.string(),
    name: z.string(),
    content: z.string(),
    timestamp: z.number(),
  }),
});

export type EmailSignatureUpdateRequest = RequestOf<typeof emailSignatureUpdateClient>;

export const emailChannelPreferenceUpsertClassificationConfigClient = defineRequestContract({
  encrypted: ['classificationPrompt'],
  derived: [],
  schema: z.object({
    channelId: z.string(),
    classificationEnabled: z.boolean(),
    classificationPrompt: z.string(),
    categoryField: z.string(),
    subCategoryField: z.string().optional().nullable(),
  }),
});

export type EmailChannelPreferenceUpsertClassificationConfigRequest = RequestOf<
  typeof emailChannelPreferenceUpsertClassificationConfigClient
>;

export const emailChannelPreferenceUpsertPriorityClassificationConfigClient = defineRequestContract({
  encrypted: ['priorityClassificationPrompt'],
  derived: [],
  schema: z.object({
    channelId: z.string(),
    priorityClassificationEnabled: z.boolean(),
    priorityClassificationPrompt: z.string().optional().nullable(),
    priorityClassificationThreshold: z.number().optional(),
  }),
});

export type EmailChannelPreferenceUpsertPriorityClassificationConfigRequest = RequestOf<
  typeof emailChannelPreferenceUpsertPriorityClassificationConfigClient
>;
