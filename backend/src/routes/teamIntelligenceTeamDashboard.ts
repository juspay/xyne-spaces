import { Router } from 'express';
import { teamIntelligenceTeamController } from '@/controllers/teamIntelligenceTeamController';

const router = Router();

// GET /api/team-intelligence-dashboard/team/bullets?from=YYYY-MM-DD&to=YYYY-MM-DD&teamId=team-123
router.get('/bullets', teamIntelligenceTeamController.getTeamBullets);

// GET /api/team-intelligence-dashboard/team/pr?from=YYYY-MM-DD&to=YYYY-MM-DD&prId=3110
router.get('/pr', teamIntelligenceTeamController.getPrByDate);

// GET /api/team-intelligence-dashboard/team/usage?from=YYYY-MM-DD&to=YYYY-MM-DD&teamId=team-123
router.get('/usage', teamIntelligenceTeamController.getTeamUsageSummary);

// GET /api/team-intelligence-dashboard/team/channel-recaps?from=YYYY-MM-DD&to=YYYY-MM-DD&teamId=team-123&page=1&limit=10
router.get('/channel-recaps', teamIntelligenceTeamController.getTeamChannelRecaps);

export default router;
