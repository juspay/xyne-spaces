import { Router } from 'express';
import { AuditLogController } from '@/controllers/auditLogController';
import { authMiddleware } from '@/middleware/auth';

const router = Router();

/**
 * @route GET /api/audit-logs?entityType=BOARD&entityId=<id>&limit=10&cursor=<opaque>
 * @desc Keyset-paginated audit feed (newest first) for one entity context,
 *       always scoped to the caller's workspace.
 * @access Authenticated workspace members
 */
router.get('/', authMiddleware.authenticate, AuditLogController.list);

export default router;
