import type { Prisma } from '@prisma/client';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { UserStatus } from '@xyne/shared';
import { backfillSchema, type JobStats, type SchemaConfig } from '@/migration/vespaWorkspaceBackfill';
import { asSystem } from './base';

const BATCH_SIZE = 50;
const BATCH_GAP_MS = 3_000; // 3 seconds between batches
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Relocated from controllers/migrationCleanupController.ts's cleanupOrphanConversations
 * background batch loop. Deletes in batches of 50 with a gap between batches.
 */
export function deleteOrphanConversations(
  where: Prisma.ConversationWhereInput,
  channelId: string | undefined,
): Promise<void> {
  return asSystem(
    ['Conversation', 'Message', 'Reaction', 'ReactionCount', 'ConversationParticipant', 'MessageAttachment'],
    'orphan-conversation cleanup sweeps across channels, above any single workspace\'s scope',
    async () => {
      let totalDeleted = 0;
      let batch = 0;

      while (true) {
        // Fetch a batch of IDs to delete
        const rows = await db.conversation.findMany({
          where,
          select: { conversationId: true },
          take: BATCH_SIZE,
        });

        if (rows.length === 0) break;

        const ids = rows.map(r => r.conversationId);

        // Fetch messageIds for this batch (needed to delete message-level children)
        const messageRows = await db.message.findMany({
          where: { conversationId: { in: ids } },
          select: { messageId: true },
        });
        const messageIds = messageRows.map(m => m.messageId);

        // Delete all child records in dependency order to avoid FK violations
        if (messageIds.length > 0) {
          await db.reaction.deleteMany({ where: { messageId: { in: messageIds } } });
          await db.reactionCount.deleteMany({ where: { messageId: { in: messageIds } } });
        }
        await db.conversationParticipant.deleteMany({ where: { conversationId: { in: ids } } });
        await db.messageAttachment.deleteMany({ where: { conversationId: { in: ids } } });
        await db.message.deleteMany({ where: { conversationId: { in: ids } } });

        const { count } = await db.conversation.deleteMany({
          where: { conversationId: { in: ids } },
        });

        totalDeleted += count;
        batch++;

        logger.info('[MigrationCleanupController] Batch deleted', {
          batch,
          batchSize: count,
          totalDeleted,
          channelId: channelId ?? 'ALL',
        });

        if (rows.length < BATCH_SIZE) break; // Last batch

        await sleep(BATCH_GAP_MS);
      }

      logger.info('[MigrationCleanupController] Deletion complete', {
        totalBatches: batch,
        totalDeleted,
        channelId: channelId ?? 'ALL',
      });
    },
  );
}

/**
 * Relocated from controllers/migrationCleanupController.ts's
 * cleanupDeactivatedUserGroupMemberships. All INACTIVE users (optionally scoped to a
 * workspace); the sweep runs above any single workspace's scope.
 */
export function findInactiveUsers(workspaceId: string | undefined) {
  return asSystem(
    ['User'],
    'deactivated-user cleanup sweep spans every workspace unless one is given',
    () =>
      db.user.findMany({
        where: { status: UserStatus.INACTIVE, ...(workspaceId ? { workspaceId } : {}) },
        select: { id: true, workspaceId: true },
      }),
  );
}

/**
 * Relocated from controllers/migrationCleanupController.ts's
 * cleanupDeactivatedUserGroupMemberships. Counts stale rows per user across the three tables,
 * for the dry-run report.
 */
export function countStaleUserRows(inactiveUserIds: string[]) {
  return asSystem(
    ['UserGroupMapping', 'UserAssignmentState', 'UserExpertiseMapping'],
    'deactivated-user cleanup sweep spans every workspace unless one is given',
    () =>
      Promise.all([
        db.userGroupMapping.groupBy({ by: ['userId'], where: { userId: { in: inactiveUserIds } }, _count: { _all: true } }),
        db.userAssignmentState.groupBy({ by: ['userId'], where: { userId: { in: inactiveUserIds } }, _count: { _all: true } }),
        db.userExpertiseMapping.groupBy({ by: ['userId'], where: { userId: { in: inactiveUserIds } }, _count: { _all: true } }),
      ]),
  );
}

/**
 * Relocated from controllers/migrationCleanupController.ts's
 * cleanupDeactivatedUserGroupMemberships background batch loop. Deletes stale rows for every
 * INACTIVE user, batched by USER_BATCH to keep IN clauses bounded.
 */
export function deleteStaleUserRows(
  inactiveUserIds: string[],
  workspaceId: string | undefined,
): Promise<{ userGroupMappings: number; userAssignmentStates: number; userExpertiseMappings: number }> {
  return asSystem(
    ['UserGroupMapping', 'UserAssignmentState', 'UserExpertiseMapping'],
    'deactivated-user cleanup sweep spans every workspace unless one is given',
    async () => {
      const deleted = { userGroupMappings: 0, userAssignmentStates: 0, userExpertiseMappings: 0 };
      const USER_BATCH = 20;

      for (let i = 0; i < inactiveUserIds.length; i += USER_BATCH) {
        const batch = inactiveUserIds.slice(i, i + USER_BATCH);

        const [gm, as, ex] = await db.$transaction([
          db.userGroupMapping.deleteMany({ where: { userId: { in: batch } } }),
          db.userAssignmentState.deleteMany({ where: { userId: { in: batch } } }),
          db.userExpertiseMapping.deleteMany({ where: { userId: { in: batch } } }),
        ]);

        deleted.userGroupMappings += gm.count;
        deleted.userAssignmentStates += as.count;
        deleted.userExpertiseMappings += ex.count;

        logger.info('[MigrationCleanupController] Deactivated-user cleanup batch done', {
          workspaceId: workspaceId ?? 'ALL',
          processedUsers: Math.min(i + USER_BATCH, inactiveUserIds.length),
          totalUsers: inactiveUserIds.length,
          deleted,
        });
      }

      logger.info('[MigrationCleanupController] Deactivated-user cleanup complete', {
        workspaceId: workspaceId ?? 'ALL',
        deactivatedUsers: inactiveUserIds.length,
        deleted,
      });

      return deleted;
    },
  );
}

/**
 * Relocated from migration/vespaWorkspaceBackfill.ts's trigger route. Cross-workspace sweep:
 * runs above tenant scope by design.
 */
export function runVespaWorkspaceBackfillJob(
  schemas: SchemaConfig[],
  delayMs: number,
  stats: JobStats,
  jobId: string,
): Promise<void> {
  return asSystem(
    ['Workspace', 'Channel', 'Project', 'MessageAttachment', 'Canvas', 'Call', 'RCA', 'Ticket', 'Email', 'Conversation', 'User'],
    'vespa workspace backfill is a cross-workspace sweep by design',
    async () => {
      try {
        for (const sc of schemas) {
          logger.info(`[VespaBackfill] Starting backfill for schema: ${sc.schema}`);
          await backfillSchema(sc, delayMs, stats);
          logger.info(`[VespaBackfill] Completed schema: ${sc.schema}`);
        }
      } catch (err) {
        stats.error = (err as Error).message;
        logger.error(`[VespaBackfill] Job ${jobId} failed:`, err);
      } finally {
        stats.running = false;
      }
    },
  );
}
