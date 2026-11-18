import { z } from 'zod';
import { defineRequestContract, type RequestOf } from '../define.js';

/**
 * Zero mutator `channel.updateCallSummaryPrompt`. The mutator enforces the prompt length and
 * stores an empty prompt as null from `derived.text`; the prompt text is read later by the
 * call-summary LLM job, a direct consumer tracked separately. `prompt: null` clears it and
 * carries nothing to encrypt or extract.
 */
export const channelUpdateCallSummaryPromptClient = defineRequestContract({
  encrypted: ['prompt'],
  derived: ['text'],
  schema: z.object({
    channelId: z.string(),
    prompt: z.string().nullable(),
  }),
});

export type ChannelUpdateCallSummaryPromptRequest = RequestOf<typeof channelUpdateCallSummaryPromptClient>;

/**
 * Zero mutator `recap.setCustomRecapPrompt`. Stored as sent; nothing is derived. The text is
 * read by the recap worker, a direct consumer tracked separately.
 */
export const recapSetCustomRecapPromptClient = defineRequestContract({
  encrypted: ['prompt'],
  derived: [],
  schema: z.object({
    channelId: z.string(),
    prompt: z.string().nullable(),
    timestamp: z.number(),
  }),
});

export type RecapSetCustomRecapPromptRequest = RequestOf<typeof recapSetCustomRecapPromptClient>;
