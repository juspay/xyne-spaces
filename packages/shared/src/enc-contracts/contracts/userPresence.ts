import { z } from 'zod';
import { defineRequestContract, type RequestOf } from '../define.js';

/**
 * Zero mutator `userPresence.upsert`. `statusContent` is stored as sent, into both
 * `user_presence` and the `users` mirror column; nothing is derived. The Slack-compatible
 * users.info API returns the status text and is a direct consumer tracked separately.
 */
export const userPresenceUpsertClient = defineRequestContract({
  encrypted: ['statusContent'],
  derived: [],
  schema: z.object({
    statusEmoji: z.string().nullable().optional(),
    statusContent: z.string().nullable().optional(),
    statusExpiryAt: z.number().nullable().optional(),
    assignmentUnavailableUntil: z.number().nullable().optional(),
    notificationsPausedUntil: z.number().nullable().optional(),
    timestamp: z.number(),
    presenceId: z.string(),
  }),
});

export type UserPresenceUpsertRequest = RequestOf<typeof userPresenceUpsertClient>;
