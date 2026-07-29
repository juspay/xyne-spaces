import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';

const TAG = '[ActivityThreadBackfill]';
const LOG_EVERY_N_BATCHES = 50;

type BackfillOptions = {
  batchSize: number;
  delayMs: number;
  dryRun: boolean;
};

type BackfillSummary = {
  batches: number;
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
};

export class ActivityThreadBackfillController {
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static buildOptions(body: unknown): BackfillOptions {
    const payload = (body ?? {}) as Partial<{ batchSize: number; delayMs: number; dryRun: boolean }>;
    const batchSize = payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 50;
    const delayMs = payload.delayMs && payload.delayMs > 0 ? payload.delayMs : 1000;
    const dryRun = payload.dryRun === true;
    return { batchSize, delayMs, dryRun };
  }

  private static async runBackfill(options: BackfillOptions): Promise<void> {
    const summary: BackfillSummary = { batches: 0, processed: 0, updated: 0, skipped: 0, errors: 0 };
    const startTime = Date.now();
    logger.info(`${TAG} Starting`, options);

    let cursor: string | null = null;

    while (true) {
      const activities: Array<{ id: string; messageId: string | null }> = await db.activity.findMany({
        where: {
          isThreadActivity: null,
          actionSource: 'message',
          messageId: { not: null },
        },
        select: {
          id: true,
          messageId: true,
        },
        orderBy: { id: 'asc' },
        take: options.batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (activities.length === 0) break;

      summary.batches += 1;

      const messageIds = [...new Set(activities.map(a => a.messageId).filter(Boolean))] as string[];

      // Fetch messages and conversations separately to avoid Prisma throwing
      // when a message's conversationId points to a deleted conversation.
      const messages = await db.message.findMany({
        where: { messageId: { in: messageIds } },
        select: { messageId: true, conversationId: true },
      });

      const conversationIds = [...new Set(messages.map(m => m.conversationId))];
      const conversations = await db.conversation.findMany({
        where: { conversationId: { in: conversationIds } },
        select: { conversationId: true, initialMessageId: true },
      });
      const convMap = new Map(conversations.map(c => [c.conversationId, c.initialMessageId]));

      const messageToIsThread = new Map<string, boolean>();
      for (const msg of messages) {
        const initialMessageId = convMap.get(msg.conversationId);
        if (initialMessageId === undefined) continue;
        messageToIsThread.set(msg.messageId, msg.messageId !== initialMessageId);
      }

      const threadIds: string[] = [];
      const channelIds: string[] = [];

      for (const activity of activities) {
        summary.processed += 1;
        if (!activity.messageId) {
          summary.skipped += 1;
          continue;
        }

        const isThread = messageToIsThread.get(activity.messageId);
        if (isThread === undefined) {
          summary.skipped += 1;
          continue;
        }

        if (isThread) {
          threadIds.push(activity.id);
        } else {
          channelIds.push(activity.id);
        }
      }

      try {
        if (!options.dryRun) {
          if (threadIds.length > 0) {
            await db.$executeRaw`
              UPDATE activities
              SET "isThreadActivity" = true
              WHERE id = ANY(${threadIds}::text[])`;
          }
          if (channelIds.length > 0) {
            await db.$executeRaw`
              UPDATE activities
              SET "isThreadActivity" = false
              WHERE id = ANY(${channelIds}::text[])`;
          }
        }
        summary.updated += threadIds.length + channelIds.length;
      } catch (error) {
        summary.errors += activities.length;
        logger.warn(`${TAG} Batch update failed`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      cursor = activities[activities.length - 1]?.id ?? null;

      if (summary.batches % LOG_EVERY_N_BATCHES === 0) {
        logger.info(`${TAG} Progress`, { ...summary });
      }

      await ActivityThreadBackfillController.sleep(options.delayMs);
    }

    logger.info(`${TAG} Done`, {
      ...summary,
      durationMs: Date.now() - startTime,
    });
  }

  static async triggerBackfill(req: Request, res: Response<ApiResponse>): Promise<Response> {
    const options = ActivityThreadBackfillController.buildOptions(req.body);

    res.status(202).json({
      success: true,
      message: 'Activity isThreadActivity backfill started in background',
      data: options,
      timestamp: new Date().toISOString(),
    });

    void (async (): Promise<void> => {
      try {
        await ActivityThreadBackfillController.runBackfill(options);
      } catch (error) {
        logger.error(`${TAG} Background run failed`, error);
      }
    })();

    return res;
  }
}
