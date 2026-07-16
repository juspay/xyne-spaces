import { ActivityType, PrismaClient, Prisma } from '@prisma/client';
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
