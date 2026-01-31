/**
 * Migration Routes Index
 * Routes migration requests to appropriate handlers (slack, jira, zoho, etc.)
 */

import express, { Router, Request, Response } from 'express';
import slackRoutes from './slack';

const router = Router();

router.use(express.json({ limit: '50mb' }));
router.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Route to Slack migration
router.use('/slack', slackRoutes);

// Handle unknown migration routes
router.use('*', (req: Request, res: Response) => {
  const path = req.path;
  return res.status(404).json({
    error: 'Migration route not found',
    message: `Migration route '${path}' does not exist. `,
  });
});

export default router;
