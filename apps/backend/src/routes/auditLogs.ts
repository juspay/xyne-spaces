import { Router } from 'express';
import { AccessType } from '@xyne/shared';
import { AuditLogController } from '@/controllers/auditLogController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();

const analyticsAdmin = authorize('ANALYTICS', AccessType.ADMIN, false);

/**
 * @route GET /api/audit-logs?entityType=BOARD&entityId=<id>&limit=10&cursor=<opaque>
 * @desc Keyset-paginated audit feed (newest first) for one entity context,
 *       always scoped to the caller's workspace.
 * @access ANALYTICS Admin (individual grants only)
 */
router.get('/', authMiddleware.authenticate, analyticsAdmin, AuditLogController.list);

export default router;

