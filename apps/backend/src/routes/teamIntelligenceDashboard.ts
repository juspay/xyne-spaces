import { Router } from 'express';
import { teamIntelligenceOrgController } from '@/controllers/teamIntelligenceOrgController';
import { mettleTeamSyncController } from '@/controllers/mettleTeamSyncController';

const router = Router();

// GET /api/team-intelligence-dashboard/org/leadership-snapshots?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/leadership-snapshots', teamIntelligenceOrgController.getOrgLeadershipSnapshots);

// Each dashboard section owns its page and page size.
router.get('/leadership-sections/:section', teamIntelligenceOrgController.getOrgLeadershipSection);

// Stable sidebar grouping based on active goals and the previous month of team evidence.
router.get('/team-goal-groups', teamIntelligenceOrgController.getTeamGoalGroups);

// GET /api/team-intelligence-dashboard/org/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/summary', teamIntelligenceOrgController.getOrgSummary);

// GET /api/team-intelligence-dashboard/org/teams?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/teams', teamIntelligenceOrgController.getOrgTeams);

// GET /api/team-intelligence-dashboard/org/bullets?from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&limit=20
router.get('/bullets', teamIntelligenceOrgController.getOrgBullets);

// GET /api/team-intelligence-dashboard/org/channel-recaps?from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&limit=10
router.get('/channel-recaps', teamIntelligenceOrgController.getOrgChannelRecaps);

// GET /api/team-intelligence-dashboard/org/mettle-teams
// Fetch list of teams directly from Mettle API
router.get('/mettle-teams', mettleTeamSyncController.getTeamsFromMettle);

export default router;
