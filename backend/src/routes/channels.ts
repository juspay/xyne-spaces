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
router.get('/:channelId/connected-email', channelController.getConnectedEmail); // OAuth-connected inbox email for an email channel
router.get('/:channelId/email-alias', channelController.getEmailAlias); // Derived inbound email alias for channel routing
router.get('/:channelId/vespa-participants', channelController.getVespaParticipants); // Channel participant user IDs from Vespa chat_container.permissions
router.get('/:channelId/members', channelController.getChannelMembers); // Active channel members as { id, name } (for participant pickers)

// Conversation Routes (nested under channels)
router.post('/:channelId/conversations', uploadMultiple, conversationController.createConversation);

export default router;
