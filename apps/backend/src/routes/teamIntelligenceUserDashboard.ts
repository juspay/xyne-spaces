import { Router } from 'express';
import { teamIntelligenceUserController } from '@/controllers/teamIntelligenceUserController';

const router = Router();

// GET /api/team-intelligence-dashboard/user/mettle-extended-info?email=user@example.com
router.get('/mettle-extended-info', teamIntelligenceUserController.getUserMettleExtendedInfo);

// GET /api/team-intelligence-dashboard/user/details?from=YYYY-MM-DD&to=YYYY-MM-DD&userEmail=user@example.com
router.get('/details', teamIntelligenceUserController.getUserDetails);

// GET /api/team-intelligence-dashboard/user/pull-requests?from=YYYY-MM-DD&to=YYYY-MM-DD&userEmail=user@example.com&page=1&limit=20
router.get('/pull-requests', teamIntelligenceUserController.getUserPullRequests);

// GET /api/team-intelligence-dashboard/user/overview?from=YYYY-MM-DD&to=YYYY-MM-DD&userEmail=user@example.com
router.get('/overview', teamIntelligenceUserController.getUserOverview);

// GET /api/team-intelligence-dashboard/user/leadership-snapshots?from=YYYY-MM-DD&to=YYYY-MM-DD&userEmail=user@example.com
router.get('/leadership-snapshots', teamIntelligenceUserController.getUserLeadershipSnapshots);
router.get(
  '/leadership-sections/:section',
  teamIntelligenceUserController.getUserLeadershipSection
);

// GET /api/team-intelligence-dashboard/user/channel-recaps?from=YYYY-MM-DD&to=YYYY-MM-DD&userEmail=user@example.com&page=1&limit=10
router.get('/channel-recaps', teamIntelligenceUserController.getUserChannelRecaps);

export default router;
