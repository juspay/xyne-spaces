import { Router } from 'express';
import { ConversationController } from '../controllers/conversationController';
import { uploadMultiple } from '../middleware/upload';

const router = Router();
const conversationController = new ConversationController();

// Static route must be registered before any /:conversationId routes.
router.get('/threads', conversationController.getUserThreads);

// Keep replyToConversation for file upload handling
router.post('/:conversationId/messages', uploadMultiple, conversationController.replyToConversation);

// Get a single conversation message by conversationId + messageId (for mobile background prefetch)
router.get('/:conversationId/message/:messageId', conversationController.getConversationMessage);

// Get conversation by message ID (for mobile background prefetch, mirrors ZQL channelConversationsPaginatedV3)
router.get('/by-message/:messageId', conversationController.getConversationByMessageId);

// Read current ephemeral agent-progress signals for a conversation (dashboard rehydrate on thread open)
router.get('/:conversationId/agent-progress', conversationController.getAgentProgress);

// Cancel an in-flight agent run for the given conversation
router.post('/:conversationId/agent-cancel', conversationController.cancelAgentRun);

// Update message content (for ticket suggestion → ticket created flow)
router.put('/:conversationId/messages/:messageId/ticket-suggestion', conversationController.updateTicketSuggestion);

// Mark a Pulse actionable item as sent (moves pulseItem → pulseSent in frontmatter)
router.put('/:conversationId/messages/:messageId/pulse-item', conversationController.markPulseItemAsSent);

// Update a Pulse merchant entry in the message frontmatter (user corrects auto-detected merchant)
router.put('/:conversationId/messages/:messageId/pulse-merchant', conversationController.updatePulseMerchant);

export default router;
