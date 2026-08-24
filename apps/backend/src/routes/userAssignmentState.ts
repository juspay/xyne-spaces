import { Router } from 'express';
import { AccessType } from '@xyne/shared';
import { userAssignmentStateController } from '@/controllers/userAssignmentStateController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();

// All routes require authentication
router.use(authMiddleware.authenticate);

// Toggle user availability for assignment (ON/OFF with datetime)
router.post('/toggle', userAssignmentStateController.toggleAssignmentAvailability);

// Hand off a member's open tickets when an admin deactivates them for a group
router.post(
  '/reassign-member-tickets',
  authorize('USER-GROUPS', AccessType.ADMIN),
  userAssignmentStateController.reassignMemberTickets
);

export default router;
