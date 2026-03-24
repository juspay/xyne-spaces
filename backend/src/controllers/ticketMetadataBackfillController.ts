import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';
import { serializeTicketMd } from '@xyne/shared';
import type { TicketCardSummary } from '@xyne/shared';

type BackfillOptions = {
  batchSize: number;
  delayMs: number;
  dryRun: boolean;
};

type BackfillSummary = {
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
};

export class TicketMetadataBackfillController {
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static buildDefaultOptions(body: unknown): BackfillOptions {
    const payload = body as Partial<{
      batchSize: number;
      delayMs: number;
      dryRun: boolean;
    }>;

    const batchSize = payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 200;
    const delayMs = payload.delayMs && payload.delayMs >= 0 ? payload.delayMs : 0;
    const dryRun = payload.dryRun === true;

    return { batchSize, delayMs, dryRun };
  }

  private static async backfillTicketMd(options: BackfillOptions): Promise<BackfillSummary> {
    const summary: BackfillSummary = { processed: 0, updated: 0, skipped: 0, errors: 0 };
    let cursor: string | null = null;

    while (true) {
      const conversations: Array<{
        conversationId: string;
        ticketId: string | null;
        ticket_md: string | null;
      }> = await db.conversation.findMany({
        where: { ticketId: { not: null } },
        select: { conversationId: true, ticketId: true, ticket_md: true },
        orderBy: { conversationId: 'asc' },
        take: options.batchSize,
        ...(cursor ? { cursor: { conversationId: cursor }, skip: 1 } : {}),
      });

      if (conversations.length === 0) break;

      for (const conversation of conversations) {
        summary.processed += 1;
        try {
          if (!conversation.ticketId) {
            summary.skipped += 1;
            continue;
          }

          const ticket = await db.ticket.findUnique({
            where: { id: conversation.ticketId },
            select: {
              id: true,
              title: true,
              description: true,
              statusV2: true,
              priority: true,
              assignedTo: true,
              createdBy: true,
              createdAt: true,
              eta: true,
              xyneId: true,
              stageName: true,
              ticketType: true,
              channelId: true,
              conversationId: true,
            },
          });

          if (!ticket) {
            summary.skipped += 1;
            continue;
          }

          const summaryData: TicketCardSummary = {
            id: ticket.id,
            title: ticket.title,
            description: ticket.description,
            statusV2: ticket.statusV2 as TicketCardSummary['statusV2'],
            priority: ticket.priority as TicketCardSummary['priority'],
            assignedTo: ticket.assignedTo ?? null,
            createdBy: ticket.createdBy,
            createdAt: ticket.createdAt.getTime(),
            eta: ticket.eta ? ticket.eta.getTime() : null,
            xyneId: ticket.xyneId,
            stageName: ticket.stageName,
            ticketType: ticket.ticketType ?? null,
            channelId: ticket.channelId,
            conversationId: ticket.conversationId,
          };

          const newMd = serializeTicketMd(summaryData);
          if (newMd === conversation.ticket_md) {
            summary.skipped += 1;
            continue;
          }

          if (!options.dryRun) {
            await db.conversation.update({
              where: { conversationId: conversation.conversationId },
              data: { ticket_md: newMd },
            });
          }
          summary.updated += 1;
        } catch (error) {
          summary.errors += 1;
          logger.warn('[TicketMetadataBackfill] Failed ticket_md update', {
            conversationId: conversation.conversationId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      cursor = conversations[conversations.length - 1]?.conversationId ?? null;
      if (options.delayMs > 0) {
        await this.sleep(options.delayMs);
      }
    }

    return summary;
  }

  static async triggerBackfill(req: Request, res: Response<ApiResponse>) {
    try {
      const options = TicketMetadataBackfillController.buildDefaultOptions(req.body);
      logger.info('[TicketMetadataBackfill] Starting backfill', options);

      const results = await TicketMetadataBackfillController.backfillTicketMd(options);

      const response: ApiResponse = {
        success: true,
        message: 'Ticket metadata backfill completed',
        data: { options, results },
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error('[TicketMetadataBackfill] Error during backfill:', error);
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run ticket metadata backfill',
        timestamp: new Date().toISOString(),
      };

      res.status(500).json(response);
    }
  }
}
