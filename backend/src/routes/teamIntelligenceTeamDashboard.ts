import { Router } from 'express';
import { teamIntelligenceTeamController } from '@/controllers/teamIntelligenceTeamController';

const router = Router();

// GET /api/team-intelligence-dashboard/team/bullets?from=YYYY-MM-DD&to=YYYY-MM-DD&teamName=Core%20Platform
router.get('/bullets', teamIntelligenceTeamController.getTeamBullets);

// GET /api/team-intelligence-dashboard/team/pr?from=YYYY-MM-DD&to=YYYY-MM-DD&prId=3110
router.get('/pr', teamIntelligenceTeamController.getPrByDate);

// GET /api/team-intelligence-dashboard/team/usage?from=YYYY-MM-DD&to=YYYY-MM-DD&teamName=Core%20Platform
router.get('/usage', teamIntelligenceTeamController.getTeamUsageSummary);

export default router;
