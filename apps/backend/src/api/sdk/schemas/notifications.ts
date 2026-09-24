/**
 * Notification request contract.
 *
 * The product route at `/api/notifications` validates none of this: `page` and
 * `limit` go through `parseInt(…) || <default>`, and `status` reaches Prisma as
 * whatever string arrived. Two failures follow from that, and both are the kind
 * this layer exists to stop:
 *
 *   - `status=unread` — the obvious guess, wrong case — matches no row and comes
 *     back as an empty list, which reads as "you have no notifications" rather
 *     than "that is not a status". The same silent no-op the search schema was
 *     written to prevent.
 *   - `page=-1` becomes a negative Prisma `skip`, which throws and surfaces as a
 *     500 the caller can do nothing about.
 *
 * Fixed here rather than in the controller, because the app's own UI calls that
 * controller too and is not asking for either behaviour to change.
 *
 * Note the deliberate asymmetry with `limit`: an unknown key or an unknown
 * `status` is **rejected**, because it is a mistake the caller wants to hear
 * about, while an oversized `limit` is **clamped**, because it is a request for
 * how much to hand back rather than a claim about the data. That is the same
 * split the SDK's own `MAX_LIMIT` makes.
 */

import { z } from 'zod';

/**
 * The states a delivery record can be in. Mirrors `NotificationStatus` in
 * `@xyne/shared` — kept as a literal list here because this file is the request
 * contract the SDK is checked against, not a re-export of the domain enum.
 */
const STATUSES = ['UNREAD', 'READ', 'DISMISSED', 'DELIVERED', 'FAILED'] as const;

export const notificationListQuerySchema = z
  .object({
    /** 1-based. The controller turns this into `(page - 1) * limit`. */
    page: z.coerce.number().int().min(1).default(1),
    /**
     * Clamped to the controller's own ceiling rather than rejected at it, so an
     * over-estimate is not an error the caller has to write code around.
     */
    limit: z.coerce.number().int().min(1).default(20).transform((v) => Math.min(v, 100)),
    /** Omit to get every status. */
    status: z.enum(STATUSES).optional(),
  })
  .strict();

/**
 * Optional side effects on mark-as-read.
 *
 * Naming a channel or a conversation additionally clears that channel's or
 * thread's unread state through `unreadService` — which is the only reason this
 * route takes a body at all. The notification id travels in the path; echoing it
 * in here is rejected, since a strict object is the only way that mistake gets
 * reported rather than ignored.
 */
export const notificationReadBodySchema = z
  .object({
    channelId: z.string().min(1).optional(),
    conversationId: z.string().min(1).optional(),
  })
  .strict();
