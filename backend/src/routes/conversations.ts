import { Router } from 'express';
import { ConversationController } from '../controllers/conversationController';
import { uploadMultiple } from '../middleware/upload';

const router = Router();
const conversationController = new ConversationController();

// Keep replyToConversation for file upload handling
router.post('/:conversationId/messages', uploadMultiple, conversationController.replyToConversation);

// Read current ephemeral agent-progress signals for a conversation (dashboard rehydrate on thread open)
router.get('/:conversationId/agent-progress', conversationController.getAgentProgress);

// Update message content (for ticket suggestion → ticket created flow)
router.put('/:conversationId/messages/:messageId/ticket-suggestion', conversationController.updateTicketSuggestion);

// Mark a Pulse actionable item as sent (moves pulseItem → pulseSent in frontmatter)
router.put('/:conversationId/messages/:messageId/pulse-item', conversationController.markPulseItemAsSent);

// Update a Pulse merchant entry in the message frontmatter (user corrects auto-detected merchant)
router.put('/:conversationId/messages/:messageId/pulse-merchant', conversationController.updatePulseMerchant);

export default router;