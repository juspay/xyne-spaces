import { Router } from 'express';
import { getUserActivities } from '@/controllers/userActivityController';

const router = Router();

// GET /api/user-activity - Get user activities with aliases applied
router.get('/', getUserActivities);

export default router;
