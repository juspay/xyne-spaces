import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';

const BATCH_SIZE = 50;
const BATCH_GAP_MS = 3_000; // 3 seconds between batches

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));


export class MigrationCleanupController {
  /**
   * DELETE /api/migration/cleanup/orphan-conversations
   * Deletes conversations with initialMessageId = 'temp' (orphaned from failed migrations).
   * Body: { channelId?: string } — omit to delete across ALL channels (use with caution).
   * Deletes in batches of 50 with a 10s gap between batches.
   */
  cleanupOrphanConversations = async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId } = req.body as { channelId?: string };

      const where = channelId
        ? { initialMessageId: 'temp', channelId }
        : { initialMessageId: 'temp' };

      // Respond immediately — batched deletion runs in background
      res.json({
        success: true,
        message: `Deletion started in batches of ${BATCH_SIZE} with ${BATCH_GAP_MS / 1000}s gap (~${BATCH_SIZE}/sec). Check server logs for progress.`,
        channelId: channelId ?? 'ALL',
      });

      // Run batched deletion in background
      (async () => {
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
      })().catch(error => {
        logger.error('[MigrationCleanupController] Batch deletion failed', { error });
      });
    } catch (error) {
      logger.error('[MigrationCleanupController] cleanupOrphanConversations failed', { error });
      res.status(500).json({ error: 'Failed to cleanup orphan conversations' });
    }
  };

  /**
   * POST /api/migration/cleanup/deactivated-user-group-memberships
   *
   * Backfill for users deactivated before the activation endpoint started
   * cleaning up group membership inline. Removes every INACTIVE user from all
   * user groups by deleting their rows from user_group_mappings,
   * user_assignment_states and user_expertise_mappings. The assignment engine
   * builds its candidate pool from user_group_mappings, so this takes stale
   * deactivated users out of all auto-assignment routing.
   *
   * Body: { dryRun?: boolean, workspaceId?: string }
   *  - dryRun (default true): only returns a per-workspace count of stale rows;
   *    deletes nothing.
   *  - workspaceId: optional scope; omit to run across ALL workspaces.
   *
   * user_workload_mappings is intentionally NOT touched — it is upsert-written
   * and self-heals from live ticket counts.
   */
  cleanupDeactivatedUserGroupMemberships = async (req: Request, res: Response): Promise<void> => {
    try {
      const { dryRun = true, workspaceId } = req.body as { dryRun?: boolean; workspaceId?: string };

      // All INACTIVE users (optionally scoped to a workspace). We carry workspaceId
      // so we can roll the per-table counts up by workspace in code.
      const inactiveUsers = await db.user.findMany({
        where: { status: 'INACTIVE', ...(workspaceId ? { workspaceId } : {}) },
        select: { id: true, workspaceId: true },
      });
      const inactiveUserIds = inactiveUsers.map(u => u.id);
      const workspaceByUser = new Map(inactiveUsers.map(u => [u.id, u.workspaceId]));

      // Per-workspace accumulator
      const workspaceStats = new Map<string, {
        workspaceId: string;
        deactivatedUsers: number;
        userGroupMappings: number;
        userAssignmentStates: number;
        userExpertiseMappings: number;
      }>();
      const ensureWorkspace = (ws: string) => {
        let stat = workspaceStats.get(ws);
        if (!stat) {
          stat = { workspaceId: ws, deactivatedUsers: 0, userGroupMappings: 0, userAssignmentStates: 0, userExpertiseMappings: 0 };
          workspaceStats.set(ws, stat);
        }
        return stat;
      };
      for (const u of inactiveUsers) ensureWorkspace(u.workspaceId).deactivatedUsers++;

      // Count stale rows per user across the three tables, then roll up by workspace.
      if (inactiveUserIds.length > 0) {
        const [groupMappingCounts, assignmentStateCounts, expertiseMappingCounts] = await Promise.all([
          db.userGroupMapping.groupBy({ by: ['userId'], where: { userId: { in: inactiveUserIds } }, _count: { _all: true } }),
          db.userAssignmentState.groupBy({ by: ['userId'], where: { userId: { in: inactiveUserIds } }, _count: { _all: true } }),
          db.userExpertiseMapping.groupBy({ by: ['userId'], where: { userId: { in: inactiveUserIds } }, _count: { _all: true } }),
        ]);
        for (const g of groupMappingCounts) {
          const ws = workspaceByUser.get(g.userId);
          if (ws) ensureWorkspace(ws).userGroupMappings += g._count._all;
        }
        for (const g of assignmentStateCounts) {
          const ws = workspaceByUser.get(g.userId);
          if (ws) ensureWorkspace(ws).userAssignmentStates += g._count._all;
        }
        for (const g of expertiseMappingCounts) {
          const ws = workspaceByUser.get(g.userId);
          if (ws) ensureWorkspace(ws).userExpertiseMappings += g._count._all;
        }
      }

      const perWorkspace = Array.from(workspaceStats.values())
        .filter(w => w.userGroupMappings + w.userAssignmentStates + w.userExpertiseMappings > 0)
        .sort((a, b) => b.userGroupMappings - a.userGroupMappings);

      const totals = perWorkspace.reduce(
        (acc, w) => ({
          userGroupMappings: acc.userGroupMappings + w.userGroupMappings,
          userAssignmentStates: acc.userAssignmentStates + w.userAssignmentStates,
          userExpertiseMappings: acc.userExpertiseMappings + w.userExpertiseMappings,
        }),
        { userGroupMappings: 0, userAssignmentStates: 0, userExpertiseMappings: 0 },
      );

      if (dryRun) {
        logger.info('[MigrationCleanupController] Deactivated-user cleanup DRY RUN', {
          workspaceId: workspaceId ?? 'ALL',
          totals,
        });
        res.json({ success: true, dryRun: true, workspaceId: workspaceId ?? 'ALL', totals, perWorkspace });
        return;
      }

      // Execute: respond immediately, then delete in the background. Deletes run
      // in batches of users to keep IN clauses bounded. Progress and the final
      // totals are written to the logs.
      res.json({
        success: true,
        dryRun: false,
        started: true,
        message: 'Cleanup started in the background. Check server logs for progress.',
        workspaceId: workspaceId ?? 'ALL',
        deactivatedUsers: inactiveUserIds.length,
        totals,
      });

      (async () => {
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
      })().catch(error => {
        logger.error('[MigrationCleanupController] Deactivated-user cleanup failed', {
          workspaceId: workspaceId ?? 'ALL',
          error,
        });
      });
    } catch (error) {
      logger.error('[MigrationCleanupController] cleanupDeactivatedUserGroupMemberships failed', { error });
      res.status(500).json({ error: 'Failed to cleanup deactivated user group memberships' });
    }
  };
}
