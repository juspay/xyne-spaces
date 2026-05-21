import { Router } from 'express';
import { mettleTeamMembersController } from '@/controllers/mettleTeamMembersController';

const router = Router();

/**
 * Mettle Team Members Routes
 * These routes fetch team member information from the external Mettle API
 */

// GET /api/mettle/team-members?teamName=Data%20Engineering
router.get('/', mettleTeamMembersController.getTeamMembers);

export default router;
