import { Router } from 'express';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';
import { AccessType } from '@prisma/client';
import { MigrationCleanupController } from '@/controllers/migrationCleanupController';
import { UnknownGroupBackfillController } from '@/controllers/unknownGroupBackfillController';
import { WorkspaceIdBackfillController } from '@/controllers/workspaceIdBackfillController';

const router = Router();
const controller = new MigrationCleanupController();
const migrationAdminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * DELETE /api/migration/cleanup/orphan-conversations
 * Body: { channelId?: string }
 * Deletes conversations with initialMessageId = 'temp' (orphaned from failed migrations).
 * Omit channelId to delete across ALL channels (use with caution).
 */
router.delete('/orphan-conversations', authMiddleware.authenticate, migrationAdminAuth, controller.cleanupOrphanConversations);

/**
 * POST /api/migration/cleanup/unknown-group-backfill
 * Body: {
 *   // Single channel
 *   slackChannelId?: string,
 *   xynespacesChannelId?: string,
 *
 *   // Multiple channels (processed one after another)
 *   channels?: { "<slackChannelId>": "<xynespacesChannelId>", ... },
 *
 *   dryRun?: boolean,    // default true — log only, no DB writes
 *   batchSize?: number,  // conversations per batch (default 20)
 *   delayMs?: number     // ms between batches (default 2000)
 * }
 *
 * Memory model: all message data is batch-scoped (GC'd after each batch).
 * Only conversation IDs are held across the full run — safe for 15k+ messages.
 */
router.post('/unknown-group-backfill', authMiddleware.authenticate, migrationAdminAuth, UnknownGroupBackfillController.triggerBackfill);
/**
 * POST /api/migration/cleanup/deactivated-user-group-memberships
 * Body: { dryRun?: boolean, workspaceId?: string }
 * Backfill: removes INACTIVE users from all user groups by deleting their
 * user_group_mappings, user_assignment_states and user_expertise_mappings rows.
 * dryRun (default true) only reports per-workspace counts; omit workspaceId to
 * run across ALL workspaces.
 */
router.post('/deactivated-user-group-memberships', authMiddleware.authenticate, migrationAdminAuth, controller.cleanupDeactivatedUserGroupMemberships);

export default router;

/**
 * POST /api/migration/cleanup/workspace-id-backfill
 * Backfills workspaceId for conversations, messages, and activities tables.
 * Body: { dryRun?: boolean, batchSize?: number, delayMs?: number, tables?: string[] }
 */
router.post('/workspace-id-backfill', authMiddleware.authenticate, migrationAdminAuth, WorkspaceIdBackfillController.triggerBackfill);