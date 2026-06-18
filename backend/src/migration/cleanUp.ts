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

export default router;

/**
 * POST /api/migration/cleanup/workspace-id-backfill
 * Backfills workspaceId for conversations, messages, and activities tables.
 * Body: { dryRun?: boolean, batchSize?: number, delayMs?: number, tables?: string[] }
 */
router.post('/workspace-id-backfill', authMiddleware.authenticate, migrationAdminAuth, WorkspaceIdBackfillController.triggerBackfill);