import { Router } from 'express';
import { ChatController } from '../controllers/chatController';
import { validateChannelAccessForGet, validateChannelAccessForPost, validateChannelAccessForPostWithDm } from '../middelware/channelValidation';
import { requirePermission } from '@/middleware/requirePermission';

const router = Router();
const chatController = new ChatController();

// postMessage also accepts a user id as `channelId` — it then posts into the
// bot's DM with that user, matching the Slack adapter's chat.postMessage.
router.post('/postMessage', requirePermission('chat:write'), validateChannelAccessForPostWithDm, chatController.postMessage);
router.post('/postEphemeral', requirePermission('chat:write'), validateChannelAccessForPost, chatController.postEphemeral);
router.post('/updateMessage', requirePermission('chat:write'), validateChannelAccessForPost, chatController.updateMessage);
router.post('/deleteMessage', requirePermission('chat:delete'), validateChannelAccessForPost, chatController.deleteMessage);
router.post('/agentProgress', requirePermission('chat:write'), validateChannelAccessForPost, chatController.agentProgress);
router.get('/channelHistory', requirePermission('channels:read'), validateChannelAccessForGet, chatController.channelHistory);
router.get('/conversationReplies', requirePermission('channels:read'), validateChannelAccessForGet, chatController.conversationReplies);
router.get('/conversationAttachments', requirePermission('channels:read'), validateChannelAccessForGet, chatController.getConversationAttachments);

export default router;
