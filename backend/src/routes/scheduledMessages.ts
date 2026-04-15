import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  listScheduledMessages,
  createScheduledMessage,
  updateScheduledMessage,
  deleteScheduledMessage,
} from '../controllers/scheduledMessageController';

const router = Router();

router.get('/', authMiddleware.authenticate, listScheduledMessages);
router.post('/', authMiddleware.authenticate, createScheduledMessage);
router.put('/:id', authMiddleware.authenticate, updateScheduledMessage);
router.delete('/:id', authMiddleware.authenticate, deleteScheduledMessage);

export default router;
