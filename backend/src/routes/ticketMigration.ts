import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { TicketMigrationController } from '@/controllers/ticketMigrationController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();

// Middleware to check for TICKET-MIGRATION admin access
const userActivityAdminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * @route POST /api/admin/migrate-tickets-xyneid
 * @desc Migrate legacy XYNE-{number} tickets to project-scoped {CODE}-{number} format
 * @access TICKET-MIGRATION Admin only
 *
 * Request Body:
 * {
 *   "projectCodeMapping": {
 *     "Euler": "EUL",
 *     "Infra": "INF",
 *     "Genius": "GEN"
 *   },
 *   "dryRun": false,  // Optional: set to true to preview without changes
 *   "limitPerProject": 100  // Optional: limit tickets per project
 * }
 */
router.post(
  '/',
  authMiddleware.authenticate,
  userActivityAdminAuth,
  TicketMigrationController.migrateTickets
);

/**
 * @route POST /api/admin/migrate-tickets-xyneid/preview
 * @desc Preview migration without making actual changes (dry run)
 * @access TICKET-MIGRATION Admin only
 */
router.post(
  '/preview',
  authMiddleware.authenticate,
  userActivityAdminAuth,
  TicketMigrationController.previewMigration
);

export default router;
