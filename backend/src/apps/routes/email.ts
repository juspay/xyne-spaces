import { Router } from 'express';
import { EmailController } from '../controllers/emailController';
import { validateChannelAccessForGet } from '../middelware/channelValidation';

const router = Router();
const emailController = new EmailController();

router.get('/emailReplies', validateChannelAccessForGet, emailController.emailReplies);

export default router;
