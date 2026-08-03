import { RequestHandler } from 'express';
import { AccessType } from '@prisma/client';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

/**
 * Shared guard for migration / backfill admin endpoints.
 *
 * Every backfill and migration route mutates production data in bulk and must
 * only be reachable by an authenticated caller who holds ADMIN on the
 * `TICKET-MIGRATION` resource. Using one shared array (instead of re-declaring
 * `authMiddleware.authenticate` + `authorize(...)` in every route file) removes
 * the copy-paste drift that historically left some backfill routes
 * authenticated-only or fully open.
 *
 * Usage:
 *   import { backfillAdminAuth } from '@/middleware/backfillAdminAuth';
 *   router.post('/', ...backfillAdminAuth, Controller.triggerBackfill);
 *
 * Order matters: `authenticate` populates `req.user`, which `authorize` reads.
 */
export const BACKFILL_ADMIN_RESOURCE = 'TICKET-MIGRATION';

export const backfillAdminAuth: RequestHandler[] = [
  authMiddleware.authenticate,
  authorize(BACKFILL_ADMIN_RESOURCE, AccessType.ADMIN),
];
