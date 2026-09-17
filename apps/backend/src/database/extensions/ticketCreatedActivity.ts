import { Prisma } from '@prisma/client';
import { ActivityType } from '@xyne/shared';

/**
 * Rides the TICKET_CREATED activity along with every `ticket.create` as a nested write,
 * so it lands in the caller's own transaction on the connection the caller already holds.
 * Issuing it as a second `ticketActivity.create` instead — as the previous middleware did —
 * needs a second pool connection while the first is still held, which deadlocked ticket
 * creation under concurrent inbound mail on 2026-09-03.
 *
 * Runs after the workspace stamper, so `workspaceId` is resolved by the time it is read;
 * the nested row is stamped explicitly rather than left to the stamper, so the activity
 * always carries the ticket's own workspace.
 *
 * `createMany` cannot express a nested write, so bulk inserts get no activity row — the
 * same gap the middleware had.
 */
export const ticketCreatedActivityExtension = Prisma.defineExtension({
  name: 'ticketCreatedActivity',
  query: {
    ticket: {
      create({ args, query }) {
        const data = args.data as Record<string, unknown> | undefined;
        if (
          !data ||
          data.activities !== undefined ||
          typeof data.createdBy !== 'string' ||
          typeof data.channelId !== 'string' ||
          typeof data.workspaceId !== 'string'
        ) {
          return query(args);
        }

        const activity = {
          updatedBy: data.createdBy,
          activityType: ActivityType.TICKET_CREATED,
          channelId: data.channelId,
          workspaceId: data.workspaceId,
          ...(data.createdAt instanceof Date && { timestamp: data.createdAt }),
          value: {
            field: 'ticketCreated',
            // Mirrors the Ticket column defaults, which are not visible in `args.data`.
            priority: typeof data.priority === 'string' ? data.priority : 'LOW',
            statusV2: typeof data.statusV2 === 'string' ? data.statusV2 : 'TODO',
            stageName: typeof data.stageName === 'string' ? data.stageName : null,
          } as Prisma.InputJsonValue,
        };

        return query({
          ...args,
          data: { ...data, activities: { create: activity } },
        } as typeof args);
      },
    },
  },
});
