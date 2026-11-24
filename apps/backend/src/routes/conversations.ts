import { Router } from 'express';
import { API } from '@xyne/shared';
import { ConversationController } from '../controllers/conversationController';
import { uploadMultiple } from '../middleware/upload';
import { serveApi } from '../middleware/serveApi';

const router = Router();
const conversationController = new ConversationController();

// Static route must be registered before any /:conversationId routes.
router.get('/threads', conversationController.getUserThreads);

router.post('/reply-drafts/:draftId/approve', conversationController.approveReplyDraft);
router.post('/reply-drafts/:draftId/decline', conversationController.declineReplyDraft);
// Latest conversations + full threads for every channel the user visited in the last N days.
router.get('/recent-visited', conversationController.getRecentVisitedConversations);

// The conversation APIs of the package's API table (packages/shared/src/enc-contracts/api.ts).
// Each needs a route here and gets its request and response types from its contract; an API
// that is not in that table cannot be added to this object. multer runs first: it fills
// req.body for the encryptedRoute steps (request CEK → DEK, response DEK → CEK).
serveApi(router, API.conversations, {
  replyToConversation: {
    method: 'post',
    path: '/:conversationId/messages',
    before: [uploadMultiple],
    resolveWorkspaceId: async (req) => req.user!.workspaceId,
    successStatus: 201,
    handle: conversationController.replyToConversation,
  },
});

// Get a single conversation message by conversationId + messageId (for mobile background prefetch)
router.get('/:conversationId/message/:messageId', conversationController.getConversationMessage);

// Get conversation by message ID (for mobile background prefetch, mirrors ZQL channelConversationsPaginatedV3)
router.get('/by-message/:messageId', conversationController.getConversationByMessageId);

// Read current ephemeral agent-progress signals for a conversation (dashboard rehydrate on thread open)
router.get('/:conversationId/agent-progress', conversationController.getAgentProgress);

// Disabled (LLM)
// router.get('/:conversationId/summary', conversationController.getSummary);

// Disabled (LLM)
// router.get('/:conversationId/recommendation', conversationController.getRecommendation);

// Cancel an in-flight agent run for the given conversation
router.post('/:conversationId/agent-cancel', conversationController.cancelAgentRun);

// Update message content (for ticket suggestion → ticket created flow)
// Disabled (LLM)
// router.put('/:conversationId/messages/:messageId/ticket-suggestion', conversationController.updateTicketSuggestion);

// Mark a Pulse actionable item as sent (moves pulseItem → pulseSent in frontmatter)
// Disabled (LLM)
// router.put('/:conversationId/messages/:messageId/pulse-item', conversationController.markPulseItemAsSent);

// Update a Pulse merchant entry in the message frontmatter (user corrects auto-detected merchant)
// Disabled (LLM)
// router.put('/:conversationId/messages/:messageId/pulse-merchant', conversationController.updatePulseMerchant);

export default router;
