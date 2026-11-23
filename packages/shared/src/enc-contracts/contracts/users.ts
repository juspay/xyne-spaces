import { z } from 'zod';
import { defineRequestContract, type RequestOf } from '../define.js';
import { derive } from '../extractors.js';
import { unreadableString } from '../unreadable-string.js';

/**
 * Create DM API (POST /api/users/me/dms, 1-on-1, group or self DM, optionally with a first
 * message); attached to its route in the backend's routes/users.ts. `message` becomes the
 * first message's content, so it is the field the client encrypts. The handler reads its
 * facts from `derived.fields.message` instead of the plaintext: `textIsEmpty` for the blank
 * check, `textLength` for the stored visible length, the mention facts for the group-DM
 * @channel/@here and personal mention notifications. The handler gets `message` as
 * `UnreadableString`.
 *
 * `forwardedMessage` stays plaintext: the client only encrypts top-level strings, and the
 * server builds the forwarded XML from the original message's stored content, so encrypting
 * `optionalMessage` needs the client to send the composed message instead (direct consumer).
 */
export const createDmClient = defineRequestContract({
  sourceToDerived: {
    message: {
      userIds: derive.userIds,
      groupIds: derive.groupIds,
      handles: derive.handles,
      mentionsChannel: derive.mentionsChannel,
      mentionsHere: derive.mentionsHere,
      textLength: derive.textLength,
      textIsEmpty: derive.textIsEmpty,
    },
  },
  schema: z.object({
    participantIds: z.array(z.string()),
    message: unreadableString().optional(),
    forwardedMessage: z
      .object({
        originalMessageId: z.string(),
        optionalMessage: z.string().optional(),
      })
      .optional(),
    silent: z.boolean().optional(),
  }),
});

export type CreateDmRequest = RequestOf<typeof createDmClient>;
