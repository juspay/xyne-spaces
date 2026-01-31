import { Router } from 'express';
import { ReactionController } from '../controllers/reactionController';

const router = Router();
const reactionController = new ReactionController();

// Message reaction routes
router.post('/:messageId/reactions', reactionController.addReaction.bind(reactionController));
router.delete('/:messageId/reactions/:emojiName', reactionController.removeReaction.bind(reactionController));
router.post('/:messageId/reactions/:emojiName/toggle', reactionController.toggleReaction.bind(reactionController));
router.get('/:messageId/reactions', reactionController.getMessageReactions.bind(reactionController));

// Bulk reactions for multiple messages
router.post('/reactions/bulk', reactionController.getMessagesReactions.bind(reactionController));
export default router;