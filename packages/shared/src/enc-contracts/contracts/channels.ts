import { z } from 'zod';
import { defineRequestContract } from '../define.js';
import { derive } from '../extractors.js';
import { unreadableString } from '../unreadable-string.js';

/**
 * Zero mutator `channel.updateCallSummaryPrompt`. The client encrypts `prompt`; it is stored as
 * received. `textIsEmpty` decides "no prompt" (the old `prompt?.trim()` check) and `rawLength`
 * enforces the 20000-character limit on the stored string (the old zod `.max`), which zod cannot
 * check on ciphertext.
 */
export const channelUpdateCallSummaryPromptClient = defineRequestContract({
  sourceToDerived: { prompt: { textIsEmpty: derive.textIsEmpty, rawLength: derive.rawLength } },
  schema: z.object({
    channelId: z.string(),
    prompt: unreadableString().nullable(),
  }),
});
