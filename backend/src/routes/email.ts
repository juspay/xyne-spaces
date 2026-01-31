import { Router } from 'express';
import { EmailController } from '../controllers/emailController';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const emailController = new EmailController();

// Send email reply (REPLY or REPLY_ALL)
router.post('/:conversationId/reply', authMiddleware.authenticate, emailController.replyToEmail);

export default router;
