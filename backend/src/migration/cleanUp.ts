import { Router } from 'express';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';
import { AccessType } from '@prisma/client';
import { MigrationCleanupController } from '@/controllers/migrationCleanupController';
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