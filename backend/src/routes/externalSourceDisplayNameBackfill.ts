import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { ExternalSourceDisplayNameBackfillController } from '@/controllers/externalSourceDisplayNameBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();

// Same admin gate as the other ticket-data backfills (`TICKET-MIGRATION`
// scope, ADMIN access). Authenticated regular users would otherwise be able
// to invoke a workspace-wide DB rewrite — this restricts it to migration
// admins only, matching `messageMetadataBackfill` etc.
const externalSourceDisplayNameBackfillAdminAuth = authorize(
  'TICKET-MIGRATION',
  AccessType.ADMIN,
);

/**
 * @route POST /api/admin/external-source-displayname-backfill
 * @route POST /migrate/api/admin/external-source-displayname-backfill
 * @desc  Cleans up legacy `external_sources.displayName` rows that were
 *        stored as "Microsoft (foo@bar.com)" instead of the bare email.
 *        The wrapped form breaks OAuth `login_hint` on reconnect.
 * @access TICKET-MIGRATION Admin only
 */
router.post(
  '/',
  authMiddleware.authenticate,
  externalSourceDisplayNameBackfillAdminAuth,
  ExternalSourceDisplayNameBackfillController.triggerBackfill,
);

export default router;
