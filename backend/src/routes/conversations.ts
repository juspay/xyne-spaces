import { Router } from 'express';
import { ConversationController } from '../controllers/conversationController';
import { uploadMultiple } from '../middleware/upload';

const router = Router();
const conversationController = new ConversationController();

// Keep replyToConversation for file upload handling
router.post('/:conversationId/messages', uploadMultiple, conversationController.replyToConversation);



export default router;