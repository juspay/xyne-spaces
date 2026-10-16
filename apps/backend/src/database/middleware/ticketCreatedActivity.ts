import { PrismaClient, Prisma } from '@prisma/client';
import { ActivityType } from '@xyne/shared';
import { logger } from '@/utils/logger';

export function setupTicketCreatedActivity(prisma: PrismaClient): void {
  prisma.$use(async (params, next) => {
    if (params.model !== 'Ticket' || params.action !== 'create') {
      return next(params);
    }

    const result = await next(params);

    if (result?.id && result?.channelId) {
      await prisma.ticketActivity.create({
        data: {
          ticketId: result.id as string,
          updatedBy: result.createdBy as string,
          timestamp: result.createdAt as Date,
          activityType: ActivityType.TICKET_CREATED,
          channelId: result.channelId as string,
          // Slack Connect: this write is on the raw client, which the connect stamper never sees, so
          // copy the ticket's (already stamped) channel handle.
          channelConnectId: (result.channelConnectId as string | null | undefined) ?? null,
          workspaceId: result.workspaceId as string,
          value: {
            field: 'ticketCreated',
            priority: result.priority as string,
            stageName: result.stageName as string,
            statusV2: result.statusV2 as string,
          } as Prisma.InputJsonValue,
        },
      }).catch(err => logger.error('[TicketCreatedActivity] Failed to write TICKET_CREATED activity', { ticketId: result.id, err }));
    }

    return result;
  });
}