import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';
import {
  addReactionToData,
  serializeReactionsMd,
  serializeRepliesMd,
  serializeInitialMessageMd,
  serializeParentMessageMd,
} from '@xyne/shared';
import type { InitialMessageSummary, ParentMessageSummary } from '@xyne/shared';

type BackfillType = 'reactions' | 'replies' | 'initialMessage' | 'parentMessage';

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

export class MessageMetadataBackfillController {
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

    const validTypes: BackfillType[] = ['reactions', 'replies', 'initialMessage', 'parentMessage'];
    let types: BackfillType[] = payload.types && payload.types.length > 0
      ? payload.types.filter((type): type is BackfillType =>
          validTypes.includes(type as BackfillType)
        )
      : validTypes;

    if (types.length === 0) {
      types = validTypes;
    }
    const batchSize = payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 200;
    const delayMs = payload.delayMs && payload.delayMs >= 0 ? payload.delayMs : 0;
    const dryRun = payload.dryRun === true;

    return { types, batchSize, delayMs, dryRun };
  }

  private static async backfillReactionsMd(options: BackfillOptions): Promise<BackfillSummary> {
    const summary: BackfillSummary = { processed: 0, updated: 0, skipped: 0, errors: 0 };
    let cursor: string | null = null;

    do {
      const messages: Array<{ messageId: string; reactions_md: string | null }> =
        await db.message.findMany({
          where: { reactions: { some: {} } },
          select: { messageId: true, reactions_md: true },
          orderBy: { messageId: 'asc' },
          take: options.batchSize,
          ...(cursor ? { cursor: { messageId: cursor }, skip: 1 } : {}),
        });

      if (messages.length === 0) break;

      for (const message of messages) {
        summary.processed += 1;
        try {
          const reactions = await db.reaction.findMany({
            where: { messageId: message.messageId },
            select: { emojiName: true, userId: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
          });

          let data: Record<string, string[]> = {};
          for (const reaction of reactions) {
            data = addReactionToData(data, reaction.emojiName, reaction.userId);
          }

          const newMd = serializeReactionsMd(data);
          if (newMd === message.reactions_md) {
            summary.skipped += 1;
            continue;
          }

          if (!options.dryRun) {
            await db.message.update({
              where: { messageId: message.messageId },
              data: { reactions_md: newMd },
            });
          }
          summary.updated += 1;
        } catch (error) {
          summary.errors += 1;
          logger.warn('[MessageMetadataBackfill] Failed reactions_md update', {
            messageId: message.messageId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      cursor = messages[messages.length - 1]?.messageId ?? null;
      if (options.delayMs > 0) {
        await this.sleep(options.delayMs);
      }
    } while (cursor);

    return summary;
  }

  private static async backfillRepliesMd(options: BackfillOptions): Promise<BackfillSummary> {
    const summary: BackfillSummary = { processed: 0, updated: 0, skipped: 0, errors: 0 };
    let cursor: string | null = null;

    do {
      const conversations: Array<{
        conversationId: string;
        initialMessageId: string | null;
        replies_md: string | null;
        replyCount: number;
      }> = await db.conversation.findMany({
        where: { replyCount: { gt: 0 } },
        select: { conversationId: true, initialMessageId: true, replies_md: true, replyCount: true },
        orderBy: { conversationId: 'asc' },
        take: options.batchSize,
        ...(cursor ? { cursor: { conversationId: cursor }, skip: 1 } : {}),
      });

      if (conversations.length === 0) break;

      for (const conversation of conversations) {
        summary.processed += 1;
        try {
          if (!conversation.initialMessageId) {
            summary.skipped += 1;
            continue;
          }

          if (conversation.replyCount === 1) {
            const initialMessage = await db.message.findUnique({
              where: { messageId: conversation.initialMessageId },
              select: { showInChannel: true },
            });

            if (initialMessage?.showInChannel) {
              summary.skipped += 1;
              continue;
            }
          }

          const replies = await db.message.findMany({
            where: {
              conversationId: conversation.conversationId,
              isDeleted: false,
              messageId: { not: conversation.initialMessageId },
            },
            select: { senderId: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
          });

          let repliers: string[] = [];
          for (const reply of replies) {
            repliers = repliers.filter(id => id !== reply.senderId);
            repliers.push(reply.senderId);
          }

          const newMd = serializeRepliesMd({ repliers });
          if (newMd === conversation.replies_md) {
            summary.skipped += 1;
            continue;
          }

          if (!options.dryRun) {
            await db.conversation.update({
              where: { conversationId: conversation.conversationId },
              data: { replies_md: newMd },
            });
          }
          summary.updated += 1;
        } catch (error) {
          summary.errors += 1;
          logger.warn('[MessageMetadataBackfill] Failed replies_md update', {
            conversationId: conversation.conversationId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      cursor = conversations[conversations.length - 1]?.conversationId ?? null;
      if (options.delayMs > 0) {
        await this.sleep(options.delayMs);
      }
    } while (cursor);

    return summary;
  }


  private static async backfillInitialMessageMd(options: BackfillOptions): Promise<BackfillSummary> {
    const summary: BackfillSummary = { processed: 0, updated: 0, skipped: 0, errors: 0 };
    let cursor: string | null = null;

    do {
      const query: Parameters<typeof db.conversation.findMany>[0] = {
        where: {
          initial_message_md: null,
          initialMessageId: { not: '' },
        },
        select: { conversationId: true, initialMessageId: true },
        orderBy: { conversationId: 'asc' },
        take: options.batchSize,
      };
      if (cursor) {
        query.cursor = { conversationId: cursor };
        query.skip = 1;
      }
      const conversations = await db.conversation.findMany(query);

      if (conversations.length === 0) break;

      const messageIds = conversations.map(c => c.initialMessageId);
      const messages = await db.message.findMany({
        where: { messageId: { in: messageIds } },
      });
      const messageMap = new Map(messages.map(m => [m.messageId, m]));

      for (const conv of conversations) {
        summary.processed += 1;
        try {
          const message = messageMap.get(conv.initialMessageId);
          if (!message) {
            summary.skipped += 1;
            continue;
          }

          const summaryData: InitialMessageSummary = {
            messageId: message.messageId,
            conversationId: message.conversationId,
            senderId: message.senderId,
            content: message.content,
            msgType: message.msgType as InitialMessageSummary['msgType'],
            hasAttachment: message.hasAttachment,
            edited: message.edited,
            isDeleted: message.isDeleted,
            showInChannel: message.showInChannel,
            visibleTo: message.visibleTo,
            createdAt: message.createdAt.getTime(),
            metadata: message.metadata ? JSON.stringify(message.metadata) : null,
            nudgeCount: message.nudgeCount,
            isSent: message.isSent,
            reactions_md: message.reactions_md,
            link_preview_md: message.link_preview_md,
            childConversationId: message.childConversationId,
          };

          const md = serializeInitialMessageMd(summaryData);
          if (!md) {
            summary.skipped += 1;
            continue;
          }

          if (!options.dryRun) {
            await db.conversation.update({
              where: { conversationId: conv.conversationId },
              data: { initial_message_md: md },
            });
          }
          summary.updated += 1;
        } catch (error) {
          summary.errors += 1;
          logger.warn('[MessageMetadataBackfill] Failed initial_message_md update', {
            conversationId: conv.conversationId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      cursor = conversations[conversations.length - 1]?.conversationId ?? null;
      if (options.delayMs > 0) {
        await this.sleep(options.delayMs);
      }
    } while (cursor);

    return summary;
  }

  private static async backfillParentMessageMd(options: BackfillOptions): Promise<BackfillSummary> {
    const summary: BackfillSummary = { processed: 0, updated: 0, skipped: 0, errors: 0 };
    let cursor: string | null = null;

    do {
      const query: Parameters<typeof db.conversation.findMany>[0] = {
        where: {
          parent_message_md: null,
          parentMessageId: { not: null },
        },
        select: { conversationId: true, parentMessageId: true },
        orderBy: { conversationId: 'asc' },
        take: options.batchSize,
      };
      if (cursor) {
        query.cursor = { conversationId: cursor };
        query.skip = 1;
      }
      const conversations = await db.conversation.findMany(query);

      if (conversations.length === 0) break;

      const messageIds = conversations
        .map(c => c.parentMessageId)
        .filter((id): id is string => id !== null);

      const messages = await db.message.findMany({
        where: { messageId: { in: messageIds } },
        select: {
          messageId: true,
          conversationId: true,
          senderId: true,
          content: true,
          msgType: true,
          createdAt: true,
        },
      });
      const messageMap = new Map(messages.map(m => [m.messageId, m]));

      for (const conv of conversations) {
        summary.processed += 1;
        try {
          if (!conv.parentMessageId) {
            summary.skipped += 1;
            continue;
          }

          const message = messageMap.get(conv.parentMessageId);
          if (!message) {
            summary.skipped += 1;
            continue;
          }

          const summaryData: ParentMessageSummary = {
            messageId: message.messageId,
            conversationId: message.conversationId,
            senderId: message.senderId,
            content: message.content,
            msgType: message.msgType as ParentMessageSummary['msgType'],
            createdAt: message.createdAt.getTime(),
          };

          const md = serializeParentMessageMd(summaryData);
          if (!md) {
            summary.skipped += 1;
            continue;
          }

          if (!options.dryRun) {
            await db.conversation.update({
              where: { conversationId: conv.conversationId },
              data: { parent_message_md: md },
            });
          }
          summary.updated += 1;
        } catch (error) {
          summary.errors += 1;
          logger.warn('[MessageMetadataBackfill] Failed parent_message_md update', {
            conversationId: conv.conversationId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      cursor = conversations[conversations.length - 1]?.conversationId ?? null;
      if (options.delayMs > 0) {
        await this.sleep(options.delayMs);
      }
    } while (cursor);

    return summary;
  }

  static async triggerBackfill(req: Request, res: Response<ApiResponse>) {
    try {
      const options = MessageMetadataBackfillController.buildDefaultOptions(req.body);
      const results: Record<string, BackfillSummary> = {};

      logger.info('[MessageMetadataBackfill] Starting backfill', options);

      if (options.types.includes('reactions')) {
        results.reactions = await MessageMetadataBackfillController.backfillReactionsMd(options);
      }

      if (options.types.includes('replies')) {
        results.replies = await MessageMetadataBackfillController.backfillRepliesMd(options);
      }

      if (options.types.includes('initialMessage')) {
        results.initialMessage = await MessageMetadataBackfillController.backfillInitialMessageMd(options);
      }

      if (options.types.includes('parentMessage')) {
        results.parentMessage = await MessageMetadataBackfillController.backfillParentMessageMd(options);
      }


      const response: ApiResponse = {
        success: true,
        message: 'Backfill completed',
        data: {
          options,
          results,
        },
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error('[MessageMetadataBackfill] Error during backfill:', error);
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run backfill',
        timestamp: new Date().toISOString(),
      };
      res.status(500).json(response);
    }
  }
}
