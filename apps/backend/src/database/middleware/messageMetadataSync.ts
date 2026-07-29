import { PrismaClient } from '@prisma/client';
import { logger } from '@/utils/logger';

const MESSAGE_WRITE_ACTIONS = new Set(['create', 'update', 'upsert', 'updateMany']);

/**
 * Prisma middleware that keeps conversation.initial_message_md and
 * conversation.parent_message_md in sync automatically.
 *
 * Covers two triggers:
 *   1. Message create/update/upsert/updateMany — re-syncs every conversation
 *      that references the affected message(s) as initialMessageId or
 *      parentMessageId.
 *   2. Conversation create/update (when initialMessageId or parentMessageId
 *      is set or changes) — populates the snapshot from the referenced message.
 *
 * Zero mutations don't go through Prisma so this only covers the
 * Prisma-direct code paths. The Zero mutation-sync handler covers the rest.
 *
 * The sync is deferred with setImmediate so that any enclosing $transaction
 * commits before the sync reads the updated state.
 */
export function setupMessageMetadataSync(prisma: PrismaClient): void {
  prisma.$use(async (params, next) => {
    // ── Message writes ──────────────────────────────────────────────────
    if (params.model === 'Message' && MESSAGE_WRITE_ACTIONS.has(params.action)) {
      // For updateMany the where filter may not match after the update
      // (e.g. where isDeleted=false, data isDeleted=true), so capture IDs first.
      let preQueryIds: string[] | undefined;
      if (params.action === 'updateMany') {
        try {
          const messages = await prisma.message.findMany({
            where: params.args?.where,
            select: { messageId: true },
          });
          preQueryIds = messages.map(m => m.messageId);
        } catch (error) {
          // Skip sync for this call — but say so, or the resulting metadata
          // divergence has no trace at all.
          logger.error('message_metadata_sync_prequery_failed', {
            action: params.action,
            where: params.args?.where,
            error,
          });
        }
      }

      const result = await next(params);

      const messageIds = getAffectedMessageIds(params, preQueryIds);
      if (messageIds.length > 0) {
        deferSync(() => syncForMessages(prisma, messageIds));
      }

      return result;
    }

    // ── Conversation writes ─────────────────────────────────────────────
    if (params.model === 'Conversation') {
      const result = await next(params);

      if (params.action === 'create') {
        const conversationId = params.args?.data?.conversationId as string | undefined;
        if (conversationId) {
          deferSync(() => syncConversation(prisma, conversationId));
        }
      }

      if (params.action === 'update') {
        const data = params.args?.data as Record<string, unknown> | undefined;
        if (data && ('initialMessageId' in data || 'parentMessageId' in data)) {
          const conversationId = params.args?.where?.conversationId as string | undefined;
          if (conversationId) {
            deferSync(() => syncConversation(prisma, conversationId));
          }
        }
      }

      if (params.action === 'upsert') {
        const conversationId = params.args?.where?.conversationId as string | undefined;
        if (conversationId) {
          deferSync(() => syncConversation(prisma, conversationId));
        }
      }

      return result;
    }

    return next(params);
  });
}

function getAffectedMessageIds(
  params: { action: string; args?: Record<string, unknown> },
  preQueryIds?: string[],
): string[] {
  switch (params.action) {
    case 'create':
      return extractId(params.args?.data, 'messageId');
    case 'update':
      return extractId(params.args?.where, 'messageId');
    case 'upsert':
      return extractId(params.args?.where, 'messageId');
    case 'updateMany':
      return preQueryIds ?? [];
    default:
      return [];
  }
}

function extractId(obj: unknown, key: string): string[] {
  if (obj && typeof obj === 'object' && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    if (typeof val === 'string') return [val];
  }
  return [];
}

/** Schedule sync after the current event-loop turn (so transactions commit first). */
function deferSync(fn: () => Promise<void>): void {
  setImmediate(() => {
    fn().catch(err => {
      logger.error('[MessageMetadataSync] sync failed', { error: err });
    });
  });
}

/**
 * After a conversation is created or its initialMessageId / parentMessageId
 * changes, populate initial_message_md and parent_message_md from the
 * referenced messages.
 */
async function syncConversation(prisma: PrismaClient, conversationId: string): Promise<void> {
  const { messageMetadataService } = await import('@/services/messageMetadataService');

  const conversation = await prisma.conversation.findUnique({
    where: { conversationId },
    select: { initialMessageId: true, parentMessageId: true },
  });

  if (!conversation) return;

  if (conversation.initialMessageId) {
    await messageMetadataService.syncInitialMessageMd(conversationId);
  }
  if (conversation.parentMessageId) {
    await messageMetadataService.syncParentMessageMd(conversationId);
  }
}

/**
 * After a message is written, find every conversation that references it
 * as initialMessageId or parentMessageId and re-sync the snapshot.
 */
async function syncForMessages(prisma: PrismaClient, messageIds: string[]): Promise<void> {
  const { messageMetadataService } = await import('@/services/messageMetadataService');

  const conversations = await prisma.conversation.findMany({
    where: {
      OR: [
        { initialMessageId: { in: messageIds } },
        { parentMessageId: { in: messageIds } },
      ],
    },
    select: { conversationId: true, initialMessageId: true, parentMessageId: true },
  });

  for (const conv of conversations) {
    if (conv.initialMessageId && messageIds.includes(conv.initialMessageId)) {
      await messageMetadataService.syncInitialMessageMd(conv.conversationId);
    }
    if (conv.parentMessageId && messageIds.includes(conv.parentMessageId)) {
      await messageMetadataService.syncParentMessageMd(conv.conversationId);
    }
  }
}
