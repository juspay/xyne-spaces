import { Router } from 'express';
import { EmailDemergeController } from '../controllers/emailDemergeController';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const emailDemergeController = new EmailDemergeController();

// Demerge an email from its current thread into a new ticket
router.post('/demerge', authMiddleware.authenticate, emailDemergeController.demergeEmail);

export default router;

