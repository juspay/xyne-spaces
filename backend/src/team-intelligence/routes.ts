import { Router } from 'express';
import { verifyTeamIntelligenceSyncAuth } from './auth';
import { teamIntelligenceSyncController } from './controllers/sync.controller';

const router = Router();

// POST /api/team-intelligence/sync
router.post('/sync', verifyTeamIntelligenceSyncAuth, teamIntelligenceSyncController.ingestDailyBatch);
// GET /api/team-intelligence/org-summary/:batchId
router.get('/org-summary/:batchId', verifyTeamIntelligenceSyncAuth, teamIntelligenceSyncController.getOrgSummary);

export default router;
