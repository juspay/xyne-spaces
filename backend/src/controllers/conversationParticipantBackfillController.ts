import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';

type BackfillType = 'lastReplyAt' | 'channelId';

type BackfillOptions = {
  types: BackfillType[];
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

export class ConversationParticipantBackfillController {
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static buildDefaultOptions(body: unknown): BackfillOptions {
    const payload = body as Partial<{
      types: BackfillType[];
      batchSize: number;
      delayMs: number;
      dryRun: boolean;
    }>;

    const validTypes: BackfillType[] = ['lastReplyAt', 'channelId'];
    let types: BackfillType[] = payload.types && payload.types.length > 0
      ? payload.types.filter((type): type is BackfillType =>
          validTypes.includes(type as BackfillType)
        )
      : validTypes;

    if (types.length === 0) {
      types = validTypes;
    }
    const batchSize = payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 500;
    const delayMs = payload.delayMs && payload.delayMs >= 0 ? payload.delayMs : 50;
    const dryRun = payload.dryRun === true;

    return { types, batchSize, delayMs, dryRun };
  }

  private static async backfillLastReplyAt(options: BackfillOptions): Promise<BackfillSummary> {
    const summary: BackfillSummary = { processed: 0, updated: 0, skipped: 0, errors: 0 };
    let cursor: string | null = null;
    let batchNumber = 0;

    do {
      batchNumber++;
      const participants: Array<{ id: string; conversationId: string }> = await db.conversationParticipant.findMany({
        where: { lastReplyAt: null },
        select: { id: true, conversationId: true },
        orderBy: { id: 'asc' },
        take: options.batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (participants.length === 0) break;

      const conversationIds: string[] = [...new Set(participants.map((p: { conversationId: string }) => p.conversationId))];
      const conversations = await db.conversation.findMany({
        where: { conversationId: { in: conversationIds } },
        select: { conversationId: true, lastActivityAt: true, replyCount: true },
      });
      const convMap = new Map(conversations.filter(c => c.replyCount > 0).map(c => [c.conversationId, c.lastActivityAt] as const));

      for (const participant of participants) {
        summary.processed += 1;
        const lastReplyAt = convMap.get(participant.conversationId) as Date | undefined;
        if (!lastReplyAt) {
          summary.skipped += 1;
          continue;
        }

        try {
          if (!options.dryRun) {
            await db.conversationParticipant.update({
              where: { id: participant.id },
              data: { lastReplyAt },
            });
          }
          summary.updated += 1;
        } catch (error) {
          summary.errors += 1;
          logger.warn('[ConvParticipantBackfill] Failed lastReplyAt update', {
            id: participant.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      cursor = participants[participants.length - 1]?.id ?? null;

      logger.info(`[ConvParticipantBackfill] lastReplyAt batch #${batchNumber} completed`, {
        batchSize: participants.length,
        totalProcessed: summary.processed,
        totalUpdated: summary.updated,
        totalSkipped: summary.skipped,
        totalErrors: summary.errors,
      });

      if (options.delayMs > 0) {
        await this.sleep(options.delayMs);
      }
    } while (cursor);

    return summary;
  }

  private static async backfillChannelId(options: BackfillOptions): Promise<BackfillSummary> {
    const summary: BackfillSummary = { processed: 0, updated: 0, skipped: 0, errors: 0 };
    let cursor: string | null = null;
    let batchNumber = 0;

    do {
      batchNumber++;
      const participants: Array<{ id: string; conversationId: string }> = await db.conversationParticipant.findMany({
        where: { channelId: null },
        select: { id: true, conversationId: true },
        orderBy: { id: 'asc' },
        take: options.batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (participants.length === 0) break;

      const conversationIds: string[] = [...new Set(participants.map((p: { conversationId: string }) => p.conversationId))];
      const conversations = await db.conversation.findMany({
        where: { conversationId: { in: conversationIds } },
        select: { conversationId: true, channelId: true },
      });
      const convMap = new Map(conversations.map(c => [c.conversationId, c.channelId] as const));

      for (const participant of participants) {
        summary.processed += 1;
        const channelId = convMap.get(participant.conversationId);
        if (!channelId) {
          summary.skipped += 1;
          continue;
        }

        try {
          if (!options.dryRun) {
            await db.conversationParticipant.update({
              where: { id: participant.id },
              data: { channelId },
            });
          }
          summary.updated += 1;
        } catch (error) {
          summary.errors += 1;
          logger.warn('[ConvParticipantBackfill] Failed channelId update', {
            id: participant.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      cursor = participants[participants.length - 1]?.id ?? null;

      logger.info(`[ConvParticipantBackfill] channelId batch #${batchNumber} completed`, {
        batchSize: participants.length,
        totalProcessed: summary.processed,
        totalUpdated: summary.updated,
        totalSkipped: summary.skipped,
        totalErrors: summary.errors,
      });

      if (options.delayMs > 0) {
        await this.sleep(options.delayMs);
      }
    } while (cursor);

    return summary;
  }

  static async triggerBackfill(req: Request, res: Response<ApiResponse>) {
    try {
      const options = ConversationParticipantBackfillController.buildDefaultOptions(req.body);
      const results: Record<string, BackfillSummary> = {};

      logger.info('[ConvParticipantBackfill] Starting backfill', options);

      if (options.types.includes('lastReplyAt')) {
        results.lastReplyAt = await ConversationParticipantBackfillController.backfillLastReplyAt(options);
      }

      if (options.types.includes('channelId')) {
        results.channelId = await ConversationParticipantBackfillController.backfillChannelId(options);
      }

      logger.info('[ConvParticipantBackfill] Backfill completed', { results });

      const response: ApiResponse = {
        success: true,
        message: 'Backfill completed',
        data: { options, results },
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error('[ConvParticipantBackfill] Error during backfill:', error);
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run backfill',
        timestamp: new Date().toISOString(),
      };
      res.status(500).json(response);
    }
  }
}
