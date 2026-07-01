/**
 * Migration Routes Index
 * Routes migration requests to appropriate handlers (slack, jira, zoho, etc.)
 */

import express, { Router, Request, Response } from 'express';
import slackRoutes from './slack';
import jiraRoutes from './jira';
import confluenceRoutes from './confluence';
import whatsappRoutes from './whatsapp';
import adminRoutes from './admin';
import cleanupRoutes from './cleanUp';
import userActivationRoutes from '@/routes/userActivation';
import vespaWorkspaceBackfillRoutes from './vespaWorkspaceBackfill';
import roleFrameworkBackfillRoutes from './roleFrameworkBackfill';

const router = Router();

/**
 * Capture raw body bytes before parsing.
 * Required by verifySlackRequest to compute the exact HMAC Slack produces.
 */
function rawBodyCapture(req: any, _res: any, buf: Buffer, _encoding: string) {
  req.rawBody = buf.toString('utf8');
}

router.use(express.json({ limit: '50mb', verify: rawBodyCapture }));
router.use(express.urlencoded({ extended: true, limit: '50mb', verify: rawBodyCapture }));

// Route to Slack migration
router.use('/slack', slackRoutes);

// Route to Jira migration
router.use('/jira', jiraRoutes);

// Route to WhatsApp migration
router.use('/whatsapp', whatsappRoutes);

// Route to Confluence migration
router.use('/confluence', confluenceRoutes);

// Cleanup routes
router.use('/cleanup', cleanupRoutes);


// User activation routes (accessible at /migrate/api/migration/user-activation)
router.use('/user-activation', userActivationRoutes);

// Vespa workspace/orgId backfill (accessible at /migrate/api/migration/vespa-workspace-backfill)
router.use('/vespa-workspace-backfill', vespaWorkspaceBackfillRoutes);

// Role-framework backfill (accessible at /migrate/api/migration/role-framework-backfill)
router.use('/role-framework-backfill', roleFrameworkBackfillRoutes);

// Admin migration utilities
router.use('/admin', adminRoutes);

// Handle unknown migration routes
router.use('*', (req: Request, res: Response) => {
  const path = req.path;
  return res.status(404).json({
    error: 'Migration route not found',
    message: `Migration route '${path}' does not exist. `,
  });
});

export default router;
