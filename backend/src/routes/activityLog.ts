import { Router } from 'express';
import { activityController } from '@/controllers/activityController';
import { authMiddleware } from '@/middleware/auth';
import { validateZod } from '@/middleware/validation';
import { ActivityPayloadSchema } from '@/validators/activityValidator';

const router = Router();

/**
 * POST /api/activity/log
 * 
 * Log user activity events (idle, active, action)
 * Requires authentication
 * 
 * Flow:
 * 1. Frontend sends activity payload
 * 2. Middleware validates payload (rejects early if malformed)
 * 3. Backend enriches data and logs
 */
router.post(
  '/log',
  authMiddleware.authenticate,
  validateZod(ActivityPayloadSchema),
  (req, res) => activityController.logActivity(req, res)
);

export default router;
