import { PrismaClient } from '@prisma/client';
import { logger } from '@/utils/logger';

/**
 * Prisma middleware that denormalizes ticket.channelId onto every
 * TicketActivity row at write time. Desk metrics query ticket_activities
 * alone (scoped by channelId + timestamp), so rows written without a
 * channelId would be invisible to those metrics.
 *
 * Zero mutations don't go through Prisma; the tx.mutate.ticket_activities
 * insert sites pass channelId explicitly. This middleware covers the many
 * Prisma-direct writers (workers, importers, side-effect handlers, services)
 * without each having to look the channel up.
 *
 * The ticket lookup runs on the root client, so an activity created in the
 * same transaction as its ticket won't resolve — those callers must pass
 * channelId themselves (the ticket-creation path does).
 */
export function setupTicketActivityChannelSync(prisma: PrismaClient): void {
  prisma.$use(async (params, next) => {
    if (params.model !== 'TicketActivity') {
      return next(params);
    }

    try {
      if (params.action === 'create') {
        const data = params.args?.data as Record<string, unknown> | undefined;
        if (data && data.channelId === undefined && typeof data.ticketId === 'string') {
          const channelId = await lookupChannelId(prisma, [data.ticketId]);
          data.channelId = channelId.get(data.ticketId) ?? null;
        }
      } else if (params.action === 'createMany') {
        const rows = params.args?.data as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(rows)) {
          const missing = rows.filter(
            r => r.channelId === undefined && typeof r.ticketId === 'string',
          );
          if (missing.length > 0) {
            const channelIds = await lookupChannelId(
              prisma,
              [...new Set(missing.map(r => r.ticketId as string))],
            );
            for (const row of missing) {
              row.channelId = channelIds.get(row.ticketId as string) ?? null;
            }
          }
        }
      }
    } catch (err) {
      // Never fail the activity write over the denormalization; the row just
      // lands with channelId null (same as pre-feature behavior).
      logger.error('[TicketActivityChannelSync] channelId lookup failed', { error: err });
    }

    return next(params);
  });
}

async function lookupChannelId(
  prisma: PrismaClient,
  ticketIds: string[],
): Promise<Map<string, string | null>> {
  const tickets = await prisma.ticket.findMany({
    where: { id: { in: ticketIds } },
    select: { id: true, channelId: true },
  });
  return new Map(tickets.map(t => [t.id, t.channelId]));
}
