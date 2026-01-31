import { Router } from 'express';
import { ChannelController } from '../controllers/channelController';
import { ConversationController } from '../controllers/conversationController';
import { uploadMultiple } from '../middleware/upload';

const router = Router();
const channelController = new ChannelController();
const conversationController = new ConversationController();

// Channel Management Routes
router.post('/', channelController.createChannel);
router.post('/check-duplicate', channelController.checkDuplicate); // Check if channel title is duplicate
router.get('/search', channelController.searchForMentions); // Unified search for users and groups
router.get('/publish-targets', channelController.getChannelsForDocs); // Get channels where user can publish docs

// Conversation Routes (nested under channels)
router.post('/:channelId/conversations', uploadMultiple, conversationController.createConversation);

export default router;