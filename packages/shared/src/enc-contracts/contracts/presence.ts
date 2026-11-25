import { z } from 'zod';
import { defineRequestContract } from '../define.js';
import { unreadableString } from '../unreadable-string.js';

/** Zero mutator `recap.setCustomRecapPrompt`. The client trims and encrypts `prompt`; it is stored as received. */
export const recapSetCustomRecapPromptClient = defineRequestContract({
  sourceToDerived: { prompt: {} },
  schema: z.object({
    channelId: z.string(),
    prompt: unreadableString().nullable(),
    timestamp: z.number(),
  }),
});

/**
 * Zero mutator `userPresence.upsert`. The client trims and encrypts `statusContent`; it is stored
 * as received, in `user_presence` and in `users`.
 */
export const userPresenceUpsertClient = defineRequestContract({
  sourceToDerived: { statusContent: {} },
  schema: z.object({
    statusEmoji: z.string().nullable().optional(),
    statusContent: unreadableString().nullable().optional(),
    statusExpiryAt: z.number().nullable().optional(),
    assignmentUnavailableUntil: z.number().nullable().optional(),
    notificationsPausedUntil: z.number().nullable().optional(),
    timestamp: z.number(),
    presenceId: z.string(),
  }),
});
