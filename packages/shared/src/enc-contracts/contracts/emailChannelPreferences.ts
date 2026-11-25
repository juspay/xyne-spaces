import { z } from 'zod';
import { defineRequestContract } from '../define.js';
import { unreadableString } from '../unreadable-string.js';

/**
 * Zero mutators `emailChannelPreference.upsertClassificationConfig` and
 * `upsertPriorityClassificationConfig`. The client encrypts the prompts; they are stored as
 * received. The audit log records only whether a prompt is set (zero/audit/config.ts).
 */
export const emailChannelPreferenceUpsertClassificationClient = defineRequestContract({
  sourceToDerived: { classificationPrompt: {} },
  schema: z.object({
    channelId: z.string(),
    classificationEnabled: z.boolean(),
    classificationPrompt: unreadableString(),
    categoryField: z.string(),
    subCategoryField: z.string().optional().nullable(),
  }),
});

export const emailChannelPreferenceUpsertPriorityClassificationClient = defineRequestContract({
  sourceToDerived: { priorityClassificationPrompt: {} },
  schema: z.object({
    channelId: z.string(),
    priorityClassificationEnabled: z.boolean(),
    priorityClassificationPrompt: unreadableString().optional().nullable(),
    priorityClassificationThreshold: z.number().optional(),
  }),
});
