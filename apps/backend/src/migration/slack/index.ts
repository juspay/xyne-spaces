/**
 * Slack Migration Routes
 * Combines command and interactive handlers
 */

import { Router } from 'express';
import commandRoutes from './command';
import interactiveRoutes from './interactive';

const router = Router();

router.use(commandRoutes);
router.use(interactiveRoutes);

export default router;
