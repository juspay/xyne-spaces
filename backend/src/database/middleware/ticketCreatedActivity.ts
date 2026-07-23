import { ActivityType, PrismaClient, Prisma } from '@prisma/client';
import { logger } from '@/utils/logger';

/**
 * Prisma middleware that records a TICKET_CREATED activity for every new
 * ticket. There is no other creation event in ticket_activities, and desk
 * metrics use this row as the per-ticket baseline for FRT/RT and the
 * "opened in range" count.
 *
 * The insert is deferred with setImmediate (same as messageMetadataSync) so
 * an enclosing $transaction commits first — e.g. email-driven creation rolls
 * the whole transaction back on duplicate externalMessageId, and the
 * existence re-check below then skips the activity instead of orphaning it.
 *
 * The activity timestamp mirrors ticket.createdAt (which email flows backdate
 * to receivedAt), not the wall clock at insert time.
 */
export function setupTicketCreatedActivity(prisma: PrismaClient): void {
  prisma.$use(async (params, next) => {
    if (params.model !== 'Ticket' || params.action !== 'create') {
      return next(params);
    }

    const result = await next(params);

    const ticketId = result?.id as string | undefined;
    if (ticketId) {
      setImmediate(() => {
        recordTicketCreated(prisma, ticketId).catch(err => {
          logger.error('[TicketCreatedActivity] failed to record activity', {
            ticketId,
            error: err,
          });
        });
      });
    }

    return result;
  });
}

async function recordTicketCreated(prisma: PrismaClient, ticketId: string): Promise<void> {
  // Re-read post-commit: skips rolled-back creations and picks up final values.
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      createdBy: true,
      createdAt: true,
      channelId: true,
      priority: true,
      stageName: true,
      statusV2: true,
      workspaceId: true,
    },
  });
  if (!ticket) return;

  const existing = await prisma.ticketActivity.findFirst({
    where: { ticketId, activityType: ActivityType.TICKET_CREATED },
    select: { id: true },
  });
  if (existing) return;

  await prisma.ticketActivity.create({
    data: {
      ticketId,
      workspaceId: ticket.workspaceId,
      updatedBy: ticket.createdBy,
      timestamp: ticket.createdAt,
      activityType: ActivityType.TICKET_CREATED,
      channelId: ticket.channelId,
      value: {
        field: 'ticketCreated',
        priority: ticket.priority,
        stageName: ticket.stageName,
        statusV2: ticket.statusV2,
      } as Prisma.InputJsonValue,
    },
  });
}
