import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';

const SLEEP_BETWEEN_BATCHES_MS = 5000;

type BackfillOptions = {
  batchSize: number;
};

type BackfillSummary = {
  batches: number;
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
};

export class TicketEmailCountBackfillController {
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static buildOptions(body: unknown): BackfillOptions {
    const payload = (body ?? {}) as Partial<{ batchSize: number }>;
    const batchSize = payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 50;
    return { batchSize };
  }

  private static async backfillChannel(
    channelId: string,
    batchSize: number,
    summary: BackfillSummary,
  ): Promise<void> {
    // Row-batched: page through the channel's tickets, update a page, sleep, repeat.
    let ticketCursor: string | null = null;
    while (true) {
      const tickets: Array<{ id: string; conversationId: string; emailCount: number | null }> =
        await db.ticket.findMany({
          where: { channelId },
          select: { id: true, conversationId: true, emailCount: true },
          orderBy: { id: 'asc' },
          take: batchSize,
          ...(ticketCursor ? { cursor: { id: ticketCursor }, skip: 1 } : {}),
        });
      if (tickets.length === 0) break;
      summary.batches += 1;

      const conversationIds = [...new Set(tickets.map(t => t.conversationId))];
      const counts = await db.email.groupBy({
        by: ['conversationId'],
        where: { conversationId: { in: conversationIds } },
        _count: { _all: true },
      });
      const countByConversation = new Map(counts.map(c => [c.conversationId, c._count._all]));

      // Group the page's tickets by their email count, then one updateMany per
      // distinct count — every ticket in a group gets the same value, so the
      // whole page collapses into a handful of statements (counts repeat a lot).
      const ticketIdsByCount = new Map<number, string[]>();
      for (const t of tickets) {
        summary.processed += 1;
        if (t.emailCount !== null && t.emailCount !== undefined) {
          summary.skipped += 1;
          continue;
        }
        const count = countByConversation.get(t.conversationId) ?? 0;
        const bucket = ticketIdsByCount.get(count);
        if (bucket) bucket.push(t.id);
        else ticketIdsByCount.set(count, [t.id]);
      }

      for (const [count, ids] of ticketIdsByCount) {
        try {
          const res = await db.ticket.updateMany({
            where: { id: { in: ids } },
            data: { emailCount: count },
          });
          summary.updated += res.count;
        } catch (error) {
          summary.errors += ids.length;
          logger.warn('[TicketEmailCountBackfill] updateMany failed', {
            count,
            ids: ids.length,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      ticketCursor = tickets[tickets.length - 1]?.id ?? null;
      logger.info('[TicketEmailCountBackfill] Batch done', {
        channelId,
        batchRows: tickets.length,
        ...summary,
      });
      await TicketEmailCountBackfillController.sleep(SLEEP_BETWEEN_BATCHES_MS);
    }
  }

  private static async runBackfill(options: BackfillOptions): Promise<void> {
    const summary: BackfillSummary = { batches: 0, processed: 0, updated: 0, skipped: 0, errors: 0 };
    const startTime = Date.now();
    logger.info('[TicketEmailCountBackfill] Starting', options);

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

      for (const channel of channels) {
        channelsSeen += 1;
        try {
          await TicketEmailCountBackfillController.backfillChannel(
            channel.id,
            options.batchSize,
            summary,
          );
        } catch (error) {
          summary.errors += 1;
          logger.warn('[TicketEmailCountBackfill] Channel failed', {
            channelId: channel.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        logger.info('[TicketEmailCountBackfill] Channel done', {
          channelId: channel.id,
          channelsSeen,
          ...summary,
        });
      }

      channelCursor = channels[channels.length - 1]?.id ?? null;
    }

    logger.info('[TicketEmailCountBackfill] Done', {
      ...summary,
      channelsSeen,
      durationMs: Date.now() - startTime,
    });
  }

  static async triggerBackfill(req: Request, res: Response<ApiResponse>): Promise<Response> {
    const options = TicketEmailCountBackfillController.buildOptions(req.body);

    res.status(202).json({
      success: true,
      message: 'Ticket emailCount backfill started in background',
      data: options,
      timestamp: new Date().toISOString(),
    });

    void (async (): Promise<void> => {
      try {
        await TicketEmailCountBackfillController.runBackfill(options);
      } catch (error) {
        logger.error('[TicketEmailCountBackfill] Background run failed', error);
      }
    })();

    return res;
  }
}
