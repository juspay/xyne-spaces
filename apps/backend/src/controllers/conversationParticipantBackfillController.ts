import { Request, Response } from 'express';
import { db } from '@/database/client';
import { withWorkspaceScope } from '@/database/tenant/context';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';

type BackfillType = 'lastReplyAt' | 'channelId' | 'staleLastReplyAt' | 'orphanedParticipants';

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

    const defaultTypes: BackfillType[] = ['lastReplyAt', 'channelId'];
    const validTypes: BackfillType[] = [
      ...defaultTypes,
      'staleLastReplyAt',
      'orphanedParticipants',
    ];
    let types: BackfillType[] =
      payload.types && payload.types.length > 0
        ? payload.types.filter((type): type is BackfillType =>
            validTypes.includes(type as BackfillType)
          )
        : defaultTypes;

    if (types.length === 0) {
      types = defaultTypes;
    }
    const batchSize = payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 500;
    const delayMs = payload.delayMs && payload.delayMs >= 0 ? payload.delayMs : 50;
    const dryRun = payload.dryRun === true;

    return { types, batchSize, delayMs, dryRun };
  }

  private static async findConversationIdsWithLiveReplies(
    conversations: Array<{ conversationId: string; initialMessageId: string }>
  ): Promise<Set<string>> {
    if (conversations.length === 0) {
      return new Set();
    }

    const replies = await db.message.findMany({
      where: {
        isDeleted: false,
        OR: conversations.map(conversation => ({
          conversationId: conversation.conversationId,
          messageId: { not: conversation.initialMessageId },
        })),
      },
      select: { conversationId: true },
      distinct: ['conversationId'],
    });

    return new Set(replies.map(reply => reply.conversationId));
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

  private static async clearStaleLastReplyAt(options: BackfillOptions): Promise<BackfillSummary> {
    const summary: BackfillSummary = {
      processed: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
    };
    const batchSize = Math.min(options.batchSize, 1_000);
    let cursor: string | null = null;
    let batchNumber = 0;

    do {
      batchNumber += 1;
      const participants: Array<{
        id: string;
        conversationId: string;
        lastReplyAt: Date | null;
      }> = await db.conversationParticipant.findMany({
        where: {
          lastReplyAt: { not: null },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: { id: true, conversationId: true, lastReplyAt: true },
        orderBy: { id: 'asc' },
        take: batchSize,
      });

      if (participants.length === 0) break;

      cursor = participants[participants.length - 1]?.id ?? null;
      summary.processed += participants.length;

      const conversationIds = [...new Set(participants.map(participant => participant.conversationId))];
      const conversations = await db.conversation.findMany({
        where: { conversationId: { in: conversationIds } },
        select: { conversationId: true, initialMessageId: true },
      });
      const existingConversationIds = new Set(
        conversations.map(conversation => conversation.conversationId)
      );
      const conversationIdsWithReplies =
        await ConversationParticipantBackfillController.findConversationIdsWithLiveReplies(
          conversations
        );
      const staleParticipants = participants.filter(
        participant =>
          existingConversationIds.has(participant.conversationId) &&
          !conversationIdsWithReplies.has(participant.conversationId)
      );

      const orphanedCount = participants.filter(
        participant => !existingConversationIds.has(participant.conversationId)
      ).length;
      summary.updated += staleParticipants.length;
      summary.skipped += participants.length - staleParticipants.length;

      if (options.dryRun) {
        // no-op
      } else if (staleParticipants.length > 0) {
        try {
          const result = await db.conversationParticipant.updateMany({
            where: {
              OR: staleParticipants.map(participant => ({
                id: participant.id,
                lastReplyAt: participant.lastReplyAt,
              })),
            },
            data: { lastReplyAt: null },
          });
          summary.updated -= staleParticipants.length - result.count;
          summary.skipped += staleParticipants.length - result.count;
        } catch (error) {
          summary.errors += staleParticipants.length;
          logger.warn('[ConvParticipantBackfill] Failed stale lastReplyAt cleanup batch', {
            batchNumber,
            staleCount: staleParticipants.length,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      logger.info(
        `[ConvParticipantBackfill] stale lastReplyAt batch #${batchNumber} completed`,
        {
          batchSize: participants.length,
          dryRun: options.dryRun,
          processed: summary.processed,
          updated: summary.updated,
          skipped: summary.skipped,
          errors: summary.errors,
          staleCount: staleParticipants.length,
          orphanedCount,
        }
      );

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

  /**
   * Removes conversation_participants rows with lastReplyAt whose referenced
   * conversation no longer exists. These rows can pass the direct-channel ACL
   * branch but make Prisma reject a required nested conversation select.
   */
  private static async cleanupOrphanedParticipants(options: BackfillOptions): Promise<BackfillSummary> {
    const summary: BackfillSummary = {
      processed: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
    };
    const batchSize = Math.min(options.batchSize, 1_000);
    let cursor: string | null = null;
    let batchNumber = 0;

    do {
      batchNumber += 1;
      const participants: Array<{ id: string; conversationId: string }> =
        await db.conversationParticipant.findMany({
          where: {
            lastReplyAt: { not: null },
            ...(cursor ? { id: { gt: cursor } } : {}),
          },
          select: { id: true, conversationId: true },
          orderBy: { id: 'asc' },
          take: batchSize,
        });

      if (participants.length === 0) break;

      cursor = participants[participants.length - 1]?.id ?? null;
      summary.processed += participants.length;

      const conversationIds = [...new Set(participants.map((p) => p.conversationId))];
      const existingConversations = await db.conversation.findMany({
        where: { conversationId: { in: conversationIds } },
        select: { conversationId: true },
      });
      const existingConversationIds = new Set(
        existingConversations.map((conversation) => conversation.conversationId)
      );
      const orphanIds = participants
        .filter((participant) => !existingConversationIds.has(participant.conversationId))
        .map((participant) => participant.id);

      summary.updated += orphanIds.length;
      summary.skipped += participants.length - orphanIds.length;

      if (options.dryRun) {
        // no-op
      } else if (orphanIds.length > 0) {
        try {
          const result = await db.conversationParticipant.deleteMany({
            where: { id: { in: orphanIds } },
          });
          summary.updated -= orphanIds.length - result.count;
          summary.skipped += orphanIds.length - result.count;
        } catch (error) {
          summary.errors += orphanIds.length;
          logger.warn('[ConvParticipantBackfill] Failed orphan cleanup batch', {
            batchNumber,
            orphanCount: orphanIds.length,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      logger.info(`[ConvParticipantBackfill] orphan cleanup batch #${batchNumber} completed`, {
        batchSize: participants.length,
        dryRun: options.dryRun,
        processed: summary.processed,
        updated: summary.updated,
        skipped: summary.skipped,
        errors: summary.errors,
        orphanCount: orphanIds.length,
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

      await withWorkspaceScope(async () => {
        if (options.types.includes('lastReplyAt')) {
          results.lastReplyAt = await ConversationParticipantBackfillController.backfillLastReplyAt(options);
        }

        if (options.types.includes('staleLastReplyAt')) {
          results.staleLastReplyAt =
            await ConversationParticipantBackfillController.clearStaleLastReplyAt(options);
        }

        if (options.types.includes('channelId')) {
          results.channelId = await ConversationParticipantBackfillController.backfillChannelId(options);
        }

        if (options.types.includes('orphanedParticipants')) {
          results.orphanedParticipants =
            await ConversationParticipantBackfillController.cleanupOrphanedParticipants(options);
        }
      });

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
