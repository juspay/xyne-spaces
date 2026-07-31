import { Router } from 'express';
import { ConversationController } from '../controllers/conversationController';
import { uploadMultiple } from '../middleware/upload';

const router = Router();
const conversationController = new ConversationController();

// Static route must be registered before any /:conversationId routes.
router.get('/threads', conversationController.getUserThreads);

// Digital Twin in-thread reply draft — approve / decline a proposal by its row
// id (owner-only; forwards delivery + feedback to claw-auth, then deletes the
// row so Zero clears the dock/badge). The caller READS proposals directly from
// Zero (twinDrafts query), so there is no GET here. Registered BEFORE the
// `/:conversationId/...` routes so "reply-drafts" is never captured as a
// conversationId.
router.post('/reply-drafts/:draftId/approve', conversationController.approveReplyDraft);
router.post('/reply-drafts/:draftId/decline', conversationController.declineReplyDraft);

// Keep replyToConversation for file upload handling
router.post('/:conversationId/messages', uploadMultiple, conversationController.replyToConversation);

// Get a single conversation message by conversationId + messageId (for mobile background prefetch)
router.get('/:conversationId/message/:messageId', conversationController.getConversationMessage);

// Get conversation by message ID (for mobile background prefetch, mirrors ZQL channelConversationsPaginatedV3)
router.get('/by-message/:messageId', conversationController.getConversationByMessageId);

// Read current ephemeral agent-progress signals for a conversation (dashboard rehydrate on thread open)
router.get('/:conversationId/agent-progress', conversationController.getAgentProgress);

// On-demand AI thread summary — generates or returns the cached one if no new messages since
router.get('/:conversationId/summary', conversationController.getSummary);

// One-time "you were just added" recommendation flag — set by the real-time
// participant-insert side effect, consumed (cleared) on read.
router.get('/:conversationId/recommendation', conversationController.getRecommendation);

// Cancel an in-flight agent run for the given conversation
router.post('/:conversationId/agent-cancel', conversationController.cancelAgentRun);

// Update message content (for ticket suggestion → ticket created flow)
router.put('/:conversationId/messages/:messageId/ticket-suggestion', conversationController.updateTicketSuggestion);

// Mark a Pulse actionable item as sent (moves pulseItem → pulseSent in frontmatter)
router.put('/:conversationId/messages/:messageId/pulse-item', conversationController.markPulseItemAsSent);

// Update a Pulse merchant entry in the message frontmatter (user corrects auto-detected merchant)
router.put('/:conversationId/messages/:messageId/pulse-merchant', conversationController.updatePulseMerchant);

export default router;
