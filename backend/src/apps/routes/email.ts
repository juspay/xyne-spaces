import { Router } from 'express';
import { EmailController } from '../controllers/emailController';
import { validateChannelAccessForGet } from '../middelware/channelValidation';
import { requirePermission } from '@/middleware/requirePermission';

const router = Router();
const emailController = new EmailController();

router.get('/emailReplies', requirePermission('email:read'), validateChannelAccessForGet, emailController.emailReplies);

export default router;
