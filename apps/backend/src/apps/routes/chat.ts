import { Router } from 'express';
import { ChatController } from '../controllers/chatController';
import { validateChannelAccessForGet } from '../middelware/channelValidation';
import { requirePermission } from '@/middleware/requirePermission';

const router = Router();
const chatController = new ChatController();

// Typed routes: src/api (the router tree), contracts in @xyne/shared (packages/shared/src/api).


// ─── Untyped routes (still mounted by apps.ts under /api/apps/chat) ────────────
router.get('/channelHistory', requirePermission('channels:read'), validateChannelAccessForGet, chatController.channelHistory);
router.get('/conversationReplies', requirePermission('channels:read'), validateChannelAccessForGet, chatController.conversationReplies);
router.get('/conversationAttachments', requirePermission('channels:read'), validateChannelAccessForGet, chatController.getConversationAttachments);

export default router;
