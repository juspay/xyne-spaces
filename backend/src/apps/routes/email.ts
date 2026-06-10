import { Router } from 'express';
import { EmailController } from '../controllers/emailController';
import { EmailController as DeskEmailController } from '@/controllers/emailController';
import { validateChannelAccessForGet } from '../middelware/channelValidation';
import { requirePermission } from '@/middleware/requirePermission';

const router = Router();
const emailController = new EmailController();
const deskEmailController = new DeskEmailController();

router.get('/emailReplies', requirePermission('email:read'), validateChannelAccessForGet, emailController.emailReplies);
router.post('/:conversationId/reply', deskEmailController.replyToEmail);

export default router;
