import { Router } from 'express';
import { userAssignmentStateController } from '@/controllers/userAssignmentStateController';
import { authMiddleware } from '@/middleware/auth';

const router = Router();

// All routes require authentication
router.use(authMiddleware.authenticate);

// Toggle user availability for assignment (ON/OFF with datetime)
router.post('/toggle', userAssignmentStateController.toggleAssignmentAvailability);

export default router;
