import { Router } from 'express';
import { ChannelController } from '../controllers/channelController';
import { ConversationController } from '../controllers/conversationController';
import { ShareAgentConversationController } from '../controllers/shareAgentConversationController';
import { uploadMultiple } from '../middleware/upload';
// Typed routes: src/api (the router tree), contracts in @xyne/shared (packages/shared/src/api).


const router = Router();
const channelController = new ChannelController();
const conversationController = new ConversationController();
const shareAgentConversationController = new ShareAgentConversationController();

// Not moved yet: creating a channel, a conversation (file uploads) and sharing an agent conversation.
router.post('/', channelController.createChannel);

// Conversation Routes (nested under channels)
router.post('/:channelId/conversations', uploadMultiple, conversationController.createConversation);
router.post('/:channelId/share-agent-conversation', shareAgentConversationController.share);

export default router;
