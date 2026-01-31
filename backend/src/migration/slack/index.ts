/**
 * Slack Migration Routes
 * Combines command and interactive handlers
 */

import { Router } from 'express';
import commandRoutes from './command';
import interactiveRoutes from './interactive';
import slackListRoutes from './slack-list';

const router = Router();

router.use(commandRoutes);
router.use(interactiveRoutes);
router.use(slackListRoutes);

export default router;
