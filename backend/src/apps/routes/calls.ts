import { Router } from 'express';
import { AppCallController } from '../controllers/callController';
import { requirePermission } from '@/middleware/requirePermission';

const router = Router();
const callController = new AppCallController();

router.post('/schedule', requirePermission('calls:write'), callController.scheduleCall);

export default router;
