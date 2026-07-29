import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';

const SLEEP_BETWEEN_BATCHES_MS = 2000;

type BackfillOptions = {
  batchSize: number;
};

type BackfillSummary = {
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
};

type ChannelTickets = {
  latestEmailIdByConversation: Map<string, string>;
  conversationIdByTicket: Map<string, string>;
  ticketIds: string[];
  totalTickets: number;
};

export class EmailChannelUnreadBackfillController {
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static buildOptions(body: unknown): BackfillOptions {
    const payload = (body ?? {}) as Partial<{ batchSize: number }>;
    const batchSize = payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 25;
    return { batchSize };
  }

  private static async loadChannelTickets(channelId: string): Promise<ChannelTickets> {
    const tickets = await db.ticket.findMany({
      where: { channelId, isArchived: false },
      select: { id: true, conversationId: true },
    });
    if (tickets.length === 0) {
      return {
        latestEmailIdByConversation: new Map(),
        conversationIdByTicket: new Map(),
        ticketIds: [],
        totalTickets: 0,
      };
    }
    const conversationIds = [...new Set(tickets.map(t => t.conversationId))];

    // DISTINCT ON (conversationId) ordered by createdAt DESC → latest email per conversation.
    const latestEmails = await db.email.findMany({
      where: { conversationId: { in: conversationIds } },
      select: { id: true, conversationId: true },
      distinct: ['conversationId'],
      orderBy: [{ conversationId: 'asc' }, { createdAt: 'desc' }],
    });

    const conversationIdByTicket = new Map<string, string>();
    for (const t of tickets) {
      conversationIdByTicket.set(t.id, t.conversationId);
    }
    return {
      latestEmailIdByConversation: new Map(latestEmails.map(e => [e.conversationId, e.id])),
      conversationIdByTicket,
      ticketIds: tickets.map(t => t.id),
      totalTickets: tickets.length,
    };
  }

  private static computeUnreadForUser(
    channelTickets: ChannelTickets,
    reads: Array<{ ticketId: string; lastReadEmailId: string }>,
  ): number {
    if (channelTickets.totalTickets === 0) return 0;
    const lastReadByTicket = new Map(reads.map(r => [r.ticketId, r.lastReadEmailId]));
    let unread = 0;
    for (const [ticketId, conversationId] of channelTickets.conversationIdByTicket) {
      const latest = channelTickets.latestEmailIdByConversation.get(conversationId);
      if (!latest) continue; // no email → not counted
      const lastRead = lastReadByTicket.get(ticketId);
      if (lastRead !== latest) unread += 1;
    }
    return unread;
  }

  private static async runBackfill(options: BackfillOptions): Promise<void> {
    const summary: BackfillSummary = { processed: 0, updated: 0, skipped: 0, errors: 0 };
    const startTime = Date.now();

    logger.info('[EmailChannelUnreadBackfill] Starting', options);

    let channelsSeen = 0;
    let channelCursor: string | null = null;
    while (true) {
      const channels: Array<{ id: string }> = await db.channel.findMany({
        where: { type: 'EMAIL' },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: options.batchSize,
        ...(channelCursor ? { cursor: { id: channelCursor }, skip: 1 } : {}),
      });
      if (channels.length === 0) break;

      logger.info('[EmailChannelUnreadBackfill] Channel page fetched', {
        count: channels.length,
        firstId: channels[0]?.id,
        lastId: channels[channels.length - 1]?.id,
      });

      for (const channel of channels) {
        channelsSeen += 1;
        let channelTickets: ChannelTickets;
        try {
          channelTickets = await EmailChannelUnreadBackfillController.loadChannelTickets(
            channel.id,
          );
        } catch (error) {
          logger.warn('[EmailChannelUnreadBackfill] Failed to load channel tickets', {
            channelId: channel.id,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
        logger.info('[EmailChannelUnreadBackfill] Channel loaded', {
          channelsSeen,
          channelId: channel.id,
          totalTickets: channelTickets.totalTickets,
        });

        let participantCursor: string | null = null;
        let participantBatchNum = 0;
        while (true) {
          const participants: Array<{ id: string; userId: string; unreadCount: number }> =
            await db.channelUserStatus.findMany({
              where: { channelId: channel.id, isDeleted: false },
              select: { id: true, userId: true, unreadCount: true },
              orderBy: { id: 'asc' },
              take: options.batchSize,
              ...(participantCursor ? { cursor: { id: participantCursor }, skip: 1 } : {}),
            });
          if (participants.length === 0) break;
          participantBatchNum += 1;
          logger.info('[EmailChannelUnreadBackfill] Participant batch', {
            channelId: channel.id,
            batchNum: participantBatchNum,
            batchSize: participants.length,
          });

          const reads =
            channelTickets.ticketIds.length === 0
              ? []
              : await db.emailRead.findMany({
                  where: {
                    userId: { in: participants.map(p => p.userId) },
                    ticketId: { in: channelTickets.ticketIds },
                  },
                  select: { userId: true, ticketId: true, lastReadEmailId: true },
                });

          const readsByUser = new Map<
            string,
            Array<{ ticketId: string; lastReadEmailId: string }>
          >();
          for (const r of reads) {
            const bucket = readsByUser.get(r.userId);
            if (bucket) bucket.push({ ticketId: r.ticketId, lastReadEmailId: r.lastReadEmailId });
            else
              readsByUser.set(r.userId, [
                { ticketId: r.ticketId, lastReadEmailId: r.lastReadEmailId },
              ]);
          }

          for (const p of participants) {
            summary.processed += 1;
            try {
              const trueCount = EmailChannelUnreadBackfillController.computeUnreadForUser(
                channelTickets,
                readsByUser.get(p.userId) ?? [],
              );
              if (trueCount === p.unreadCount) {
                summary.skipped += 1;
                continue;
              }
              await db.channelUserStatus.update({
                where: { id: p.id },
                data: { unreadCount: trueCount, updatedAt: new Date() },
              });
              summary.updated += 1;
            } catch (error) {
              summary.errors += 1;
              logger.warn('[EmailChannelUnreadBackfill] Row update failed', {
                id: p.id,
                channelId: channel.id,
                userId: p.userId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }

          logger.info('[EmailChannelUnreadBackfill] Participant batch done', {
            channelId: channel.id,
            batchNum: participantBatchNum,
            totalProcessed: summary.processed,
            totalUpdated: summary.updated,
            totalSkipped: summary.skipped,
            totalErrors: summary.errors,
          });
          participantCursor = participants[participants.length - 1]?.id ?? null;
          logger.info('[EmailChannelUnreadBackfill] Sleeping before next participant batch', {
            sleepMs: SLEEP_BETWEEN_BATCHES_MS,
          });
          await EmailChannelUnreadBackfillController.sleep(SLEEP_BETWEEN_BATCHES_MS);
        }
      }

      channelCursor = channels[channels.length - 1]?.id ?? null;
    }

    logger.info('[EmailChannelUnreadBackfill] Done', {
      ...summary,
      channelsSeen,
      durationMs: Date.now() - startTime,
    });
  }

  static async triggerBackfill(req: Request, res: Response<ApiResponse>): Promise<Response> {
    const options = EmailChannelUnreadBackfillController.buildOptions(req.body);

    res.status(202).json({
      success: true,
      message: 'Backfill started in background',
      data: options,
      timestamp: new Date().toISOString(),
    });

    void (async (): Promise<void> => {
      try {
        await EmailChannelUnreadBackfillController.runBackfill(options);
      } catch (error) {
        logger.error('[EmailChannelUnreadBackfill] Background run failed', error);
      }
    })();

    return res;
  }
}
