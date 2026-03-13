import { Router } from 'express';
import { ChatController } from '../controllers/chatController';
import { validateChannelAccess } from '../middelware/channelValidation';

const router = Router();
const chatController = new ChatController();

router.post('/postMessage', validateChannelAccess, chatController.postMessage);
router.post('/updateMessage', validateChannelAccess, chatController.updateMessage);

export default router;
