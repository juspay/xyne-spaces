import { Router } from 'express';
import { ConversationController } from '../controllers/conversationController';
import { uploadMultiple } from '../middleware/upload';
import { manifestRequestBodyMiddleware } from '../middleware/decryptionMiddleware';
import { AppError } from '../middleware/errorHandler';
import { db } from '../database/client';

const router = Router();
const conversationController = new ConversationController();

// A reply is stored under its conversation's workspace (messageRepository.create resolves it
// the same way), so that workspace's DEK is what the manifest's MASTER_DEK fields become.
const transformReplyBody = manifestRequestBodyMiddleware({
  resolveWorkspaceId: async (req) => {
    const conversation = await db.conversation.findUnique({
      where: { conversationId: req.params.conversationId },
      select: { workspaceId: true },
    });
    if (!conversation) {
      throw new AppError('Conversation not found', 404);
    }
    return conversation.workspaceId;
  },
});

// Static route must be registered before any /:conversationId routes.
router.get('/threads', conversationController.getUserThreads);

router.post('/reply-drafts/:draftId/approve', conversationController.approveReplyDraft);
router.post('/reply-drafts/:draftId/decline', conversationController.declineReplyDraft);
// Latest conversations + full threads for every channel the user visited in the last N days.
router.get('/recent-visited', conversationController.getRecentVisitedConversations);

// Keep replyToConversation for file upload handling
// Multipart: the manifest rule check and session-key transform run here, after multer has
// filled req.body (it is still empty when the auth middleware runs). With the manifest rule
// active, `content` reaches the controller as workspace-DEK ciphertext, not plaintext.
router.post('/:conversationId/messages', uploadMultiple, transformReplyBody, conversationController.replyToConversation);

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
