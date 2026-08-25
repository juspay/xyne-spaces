import { Router } from 'express';
import { ChatController } from '../controllers/chatController';
import { validateChannelAccessForGet, validateChannelAccessForPost } from '../middelware/channelValidation';
import { requirePermission } from '@/middleware/requirePermission';

const router = Router();
const chatController = new ChatController();

router.post('/postMessage', requirePermission('chat:write'), validateChannelAccessForPost, chatController.postMessage);
router.post('/postEphemeral', requirePermission('chat:write'), validateChannelAccessForPost, chatController.postEphemeral);
router.post('/updateMessage', requirePermission('chat:write'), validateChannelAccessForPost, chatController.updateMessage);
router.post('/agentProgress', requirePermission('chat:write'), validateChannelAccessForPost, chatController.agentProgress);
router.get('/channelHistory', requirePermission('channels:read'), validateChannelAccessForGet, chatController.channelHistory);
router.get('/conversationReplies', requirePermission('channels:read'), validateChannelAccessForGet, chatController.conversationReplies);
router.get('/conversationAttachments', requirePermission('channels:read'), validateChannelAccessForGet, chatController.getConversationAttachments);

export default router;
