import { Router } from 'express';
import { AccessType } from '@xyne/shared';
import { AuditLogController } from '@/controllers/auditLogController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();

const analyticsAdmin = authorize('ANALYTICS', AccessType.ADMIN, false);

/**
 * @route GET /api/audit-logs/entities?entityType=BOARD
 * @desc Entities of a type that have audit history (id + display name), sorted by name.
 * @access ANALYTICS Admin
 */
router.get('/entities', authMiddleware.authenticate, analyticsAdmin, AuditLogController.entities);

/**
 * @route GET /api/audit-logs/export?entityType=BOARD&entityId=<id>&from=<ms>&to=<ms>
 * @desc Every entry in the window, newest first and capped, for CSV download.
 *       entityId is optional (omitted = every entity of the type).
 * @access ANALYTICS Admin
 */
router.get('/export', authMiddleware.authenticate, analyticsAdmin, AuditLogController.exportLogs);

/**
 * @route GET /api/audit-logs?entityType=BOARD&entityId=<id>&from=<ms>&to=<ms>&limit=10&cursor=<opaque>
 * @desc Keyset-paginated audit feed (newest first), always scoped to the caller's
 *       workspace. entityId, from and to are optional.
 * @access ANALYTICS Admin (individual grants only)
 */
router.get('/', authMiddleware.authenticate, analyticsAdmin, AuditLogController.list);

export default router;
