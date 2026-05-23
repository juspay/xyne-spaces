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

export class EmailReadAtBackfillController {
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static buildOptions(body: unknown): BackfillOptions {
    const payload = (body ?? {}) as Partial<{ batchSize: number }>;
    const batchSize = payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 25;
    return { batchSize };
  }

  private static async backfillChannel(
    channelId: string,
    batchSize: number,
    summary: BackfillSummary,
  ): Promise<void> {
    const tickets = await db.ticket.findMany({
      where: { channelId },
      select: { id: true, conversationId: true, lastEmailAt: true },
    });
    if (tickets.length === 0) return;

    const conversationIds = [...new Set(tickets.map(t => t.conversationId))];

    // Latest email per conversation (max createdAt) — same "latest" as TicketListRow.
    const latestEmails = await db.email.findMany({
      where: { conversationId: { in: conversationIds } },
      select: { id: true, conversationId: true },
      distinct: ['conversationId'],
      orderBy: [{ conversationId: 'asc' }, { createdAt: 'desc' }],
    });
    const latestEmailIdByConversation = new Map(
      latestEmails.map(e => [e.conversationId, e.id]),
    );
    const lastEmailAtByTicket = new Map(tickets.map(t => [t.id, t.lastEmailAt]));
    const conversationIdByTicket = new Map(tickets.map(t => [t.id, t.conversationId]));
    const ticketIds = tickets.map(t => t.id);

    // Row-batched: update a page of email_reads, sleep, then the next page.
    let readCursor: string | null = null;
    while (true) {
      const reads: Array<{
        id: string;
        ticketId: string;
        lastReadEmailId: string;
        lastReadEmailAt: Date;
      }> = await db.emailRead.findMany({
        where: { ticketId: { in: ticketIds } },
        select: {
          id: true,
          ticketId: true,
          lastReadEmailId: true,
          lastReadEmailAt: true,
        },
        orderBy: { id: 'asc' },
        take: batchSize,
        ...(readCursor ? { cursor: { id: readCursor }, skip: 1 } : {}),
      });
      if (reads.length === 0) break;
      summary.batches += 1;

      // Per-row updates: each row's lastReadEmailAt is unique (the ticket's
      // lastEmailAt, or the row's own updatedAt), so updateMany can't be used.
      for (const r of reads) {
        summary.processed += 1;
        try {
          const conversationId = conversationIdByTicket.get(r.ticketId);
          const latestEmailId = conversationId
            ? latestEmailIdByConversation.get(conversationId)
            : undefined;
          // "read" today = the row points at the conversation's latest email.
          const isRead = !!latestEmailId && r.lastReadEmailId === latestEmailId;
          const ticketLastEmailAt = lastEmailAtByTicket.get(r.ticketId);
          // read → snapshot lastEmailAt exactly; unread → 1s below it, so the
          // reader check `lastReadEmailAt >= lastEmailAt` is true only for read.
          const lastReadEmailAt = !ticketLastEmailAt
            ? new Date(0)
            : isRead
              ? ticketLastEmailAt
              : new Date(ticketLastEmailAt.getTime() - 1000);
          await db.emailRead.update({
            where: { id: r.id },
            data: { lastReadEmailAt },
          });
          summary.updated += 1;
        } catch (error) {
          summary.errors += 1;
          logger.warn('[EmailReadAtBackfill] email_read update failed', {
            id: r.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      readCursor = reads[reads.length - 1]?.id ?? null;
      logger.info('[EmailReadAtBackfill] Batch done', {
        channelId,
        batchRows: reads.length,
        ...summary,
      });
      await EmailReadAtBackfillController.sleep(SLEEP_BETWEEN_BATCHES_MS);
    }
  }

  private static async runBackfill(options: BackfillOptions): Promise<void> {
    const summary: BackfillSummary = { batches: 0, processed: 0, updated: 0, skipped: 0, errors: 0 };
    const startTime = Date.now();
    logger.info('[EmailReadAtBackfill] Starting', options);

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
          await EmailReadAtBackfillController.backfillChannel(
            channel.id,
            options.batchSize,
            summary,
          );
        } catch (error) {
          summary.errors += 1;
          logger.warn('[EmailReadAtBackfill] Channel failed', {
            channelId: channel.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        logger.info('[EmailReadAtBackfill] Channel done', {
          channelId: channel.id,
          channelsSeen,
          ...summary,
        });
      }

      channelCursor = channels[channels.length - 1]?.id ?? null;
    }

    logger.info('[EmailReadAtBackfill] Done', {
      ...summary,
      channelsSeen,
      durationMs: Date.now() - startTime,
    });
  }

  static async triggerBackfill(req: Request, res: Response<ApiResponse>): Promise<Response> {
    const options = EmailReadAtBackfillController.buildOptions(req.body);

    res.status(202).json({
      success: true,
      message: 'Email read-at backfill started in background',
      data: options,
      timestamp: new Date().toISOString(),
    });

    void (async (): Promise<void> => {
      try {
        await EmailReadAtBackfillController.runBackfill(options);
      } catch (error) {
        logger.error('[EmailReadAtBackfill] Background run failed', error);
      }
    })();

    return res;
  }
}
