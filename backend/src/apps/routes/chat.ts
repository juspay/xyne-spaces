import { Router } from 'express';
import { ChatController } from '../controllers/chatController';
import { validateChannelAccessForGet, validateChannelAccessForPost } from '../middelware/channelValidation';

const router = Router();
const chatController = new ChatController();

router.post('/postMessage', validateChannelAccessForPost, chatController.postMessage);
router.post('/updateMessage', validateChannelAccessForPost, chatController.updateMessage);
router.post('/agentProgress', validateChannelAccessForPost, chatController.agentProgress);
router.get('/channelHistory', validateChannelAccessForGet, chatController.channelHistory);
router.get('/conversationReplies', validateChannelAccessForGet, chatController.conversationReplies);

export default router;
