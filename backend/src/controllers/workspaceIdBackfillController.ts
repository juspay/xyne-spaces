import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';

const TAG = '[WorkspaceIdBackfill]';

type BackfillOptions = {
  batchSize: number;
  delayMs: number;
  dryRun: boolean;
  tables: ('conversations' | 'messages' | 'activities')[];
};

type TableSummary = {
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
};

type BackfillSummary = {
  conversations: TableSummary;
  messages: TableSummary;
  activities: TableSummary;
};

export class WorkspaceIdBackfillController {
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static buildOptions(body: unknown): BackfillOptions {
    const payload = (body ?? {}) as Partial<{
      batchSize: number;
      delayMs: number;
      dryRun: boolean;
      tables: ('conversations' | 'messages' | 'activities')[];
    }>;
    return {
      batchSize: payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 100,
      delayMs: payload.delayMs && payload.delayMs >= 0 ? payload.delayMs : 1000,
      dryRun: payload.dryRun === true,
      tables: payload.tables ?? ['conversations', 'messages', 'activities'],
    };
  }

  private static async backfillConversations(
    options: BackfillOptions,
  ): Promise<TableSummary> {
    const summary: TableSummary = { processed: 0, updated: 0, skipped: 0, errors: 0 };
    let cursor: string | null = null;
    let batchNumber = 0;

    do {
      batchNumber += 1;
      const conversations: { conversationId: string; channelId: string }[] = await db.conversation.findMany({
        where: { workspaceId: null },
        select: { conversationId: true, channelId: true },
        orderBy: { conversationId: 'asc' },
        take: options.batchSize,
        ...(cursor ? { cursor: { conversationId: cursor }, skip: 1 } : {}),
      });

      if (conversations.length === 0) break;

      const channelIds = [...new Set(conversations.map(c => c.channelId))];
      const channels = await db.channel.findMany({
        where: { id: { in: channelIds } },
        select: { id: true, workspaceId: true },
      });
      const workspaceByChannelId = new Map(channels.map(c => [c.id, c.workspaceId]));

      summary.processed += conversations.length;

      const byWorkspace = new Map<string, string[]>();
      for (const conv of conversations) {
        const workspaceId = workspaceByChannelId.get(conv.channelId);
        if (!workspaceId) {
          summary.skipped += 1;
          continue;
        }
        const bucket = byWorkspace.get(workspaceId);
        if (bucket) {
          bucket.push(conv.conversationId);
        } else {
          byWorkspace.set(workspaceId, [conv.conversationId]);
        }
      }

      for (const [workspaceId, ids] of byWorkspace) {
        if (options.dryRun) {
          summary.updated += ids.length;
          continue;
        }
        try {
          const result = await db.conversation.updateMany({
            where: { conversationId: { in: ids } },
            data: { workspaceId },
          });
          summary.updated += result.count;
        } catch (error) {
          summary.errors += ids.length;
          logger.warn(`${TAG} Failed to update conversations batch`, {
            workspaceId,
            count: ids.length,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      cursor = conversations[conversations.length - 1]?.conversationId ?? null;
      logger.info(`${TAG} Conversations batch #${batchNumber}`, { batchSize: conversations.length, ...summary });
      if (options.delayMs > 0) await this.sleep(options.delayMs);
    } while (cursor);

    return summary;
  }

  private static async backfillMessages(
    options: BackfillOptions,
  ): Promise<TableSummary> {
    const summary: TableSummary = { processed: 0, updated: 0, skipped: 0, errors: 0 };
    let cursor: string | null = null;
    let batchNumber = 0;

    do {
      batchNumber += 1;
      const messages: { messageId: string; conversationId: string }[] = await db.message.findMany({
        where: { workspaceId: null },
        select: { messageId: true, conversationId: true },
        orderBy: { messageId: 'asc' },
        take: options.batchSize,
        ...(cursor ? { cursor: { messageId: cursor }, skip: 1 } : {}),
      });

      if (messages.length === 0) break;

      const conversationIds = [...new Set(messages.map(m => m.conversationId))];
      const conversations = await db.conversation.findMany({
        where: { conversationId: { in: conversationIds } },
        select: { conversationId: true, workspaceId: true },
      });
      const workspaceByConvId = new Map(conversations.map(c => [c.conversationId, c.workspaceId]));

      summary.processed += messages.length;

      const byWorkspace = new Map<string, string[]>();
      for (const msg of messages) {
        const workspaceId = workspaceByConvId.get(msg.conversationId);
        if (!workspaceId) {
          summary.skipped += 1;
          continue;
        }
        const bucket = byWorkspace.get(workspaceId);
        if (bucket) {
          bucket.push(msg.messageId);
        } else {
          byWorkspace.set(workspaceId, [msg.messageId]);
        }
      }

      for (const [workspaceId, ids] of byWorkspace) {
        if (options.dryRun) {
          summary.updated += ids.length;
          continue;
        }
        try {
          const result = await db.message.updateMany({
            where: { messageId: { in: ids } },
            data: { workspaceId },
          });
          summary.updated += result.count;
        } catch (error) {
          summary.errors += ids.length;
          logger.warn(`${TAG} Failed to update messages batch`, {
            workspaceId,
            count: ids.length,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      cursor = messages[messages.length - 1]?.messageId ?? null;
      logger.info(`${TAG} Messages batch #${batchNumber}`, { batchSize: messages.length, ...summary });
      if (options.delayMs > 0) await this.sleep(options.delayMs);
    } while (cursor);

    return summary;
  }

  private static async backfillActivities(
    options: BackfillOptions,
  ): Promise<TableSummary> {
    const summary: TableSummary = { processed: 0, updated: 0, skipped: 0, errors: 0 };
    let cursor: string | null = null;
    let batchNumber = 0;

    do {
      batchNumber += 1;
      const activities: { id: string; userId: string }[] = await db.activity.findMany({
        where: { workspaceId: null },
        select: { id: true, userId: true },
        orderBy: { id: 'asc' },
        take: options.batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (activities.length === 0) break;

      const userIds = [...new Set(activities.map(a => a.userId))];
      const users = await db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, workspaceId: true },
      });
      const wsByUserId = new Map(users.map(u => [u.id, u.workspaceId]));

      summary.processed += activities.length;

      const byWorkspace = new Map<string, string[]>();
      for (const act of activities) {
        const workspaceId = wsByUserId.get(act.userId);
        if (!workspaceId) {
          summary.skipped += 1;
          continue;
        }
        const bucket = byWorkspace.get(workspaceId);
        if (bucket) {
          bucket.push(act.id);
        } else {
          byWorkspace.set(workspaceId, [act.id]);
        }
      }

      for (const [workspaceId, ids] of byWorkspace) {
        if (options.dryRun) {
          summary.updated += ids.length;
          continue;
        }
        try {
          const result = await db.activity.updateMany({
            where: { id: { in: ids } },
            data: { workspaceId },
          });
          summary.updated += result.count;
        } catch (error) {
          summary.errors += ids.length;
          logger.warn(`${TAG} Failed to update activities batch`, {
            workspaceId,
            count: ids.length,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      cursor = activities[activities.length - 1]?.id ?? null;
      logger.info(`${TAG} Activities batch #${batchNumber}`, { batchSize: activities.length, ...summary });
      if (options.delayMs > 0) await this.sleep(options.delayMs);
    } while (cursor);

    return summary;
  }

  static async triggerBackfill(req: Request, res: Response<ApiResponse>): Promise<void> {
    try {
      const options = WorkspaceIdBackfillController.buildOptions(req.body);
      logger.info(`${TAG} Starting backfill`, options);

      const summary: BackfillSummary = {
        conversations: { processed: 0, updated: 0, skipped: 0, errors: 0 },
        messages: { processed: 0, updated: 0, skipped: 0, errors: 0 },
        activities: { processed: 0, updated: 0, skipped: 0, errors: 0 },
      };

      if (options.tables.includes('conversations')) {
        summary.conversations = await WorkspaceIdBackfillController.backfillConversations(options);
      }
      if (options.tables.includes('messages')) {
        summary.messages = await WorkspaceIdBackfillController.backfillMessages(options);
      }
      if (options.tables.includes('activities')) {
        summary.activities = await WorkspaceIdBackfillController.backfillActivities(options);
      }

      res.status(200).json({
        success: true,
        message: options.dryRun ? 'Dry run completed' : 'Backfill completed',
        data: { options, summary },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error(`${TAG} Error during backfill:`, error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run workspaceId backfill',
        timestamp: new Date().toISOString(),
      });
    }
  }
}
