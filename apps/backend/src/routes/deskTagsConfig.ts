import { Router } from 'express';
import { authMiddleware } from '@/middleware/auth';
import { DeskTagsConfigController } from '../controllers/deskTagsConfigController';

const router = Router({ mergeParams: true }); // mergeParams to access :channelId from parent
const controller = new DeskTagsConfigController();

router.get('/', authMiddleware.authenticate, controller.getConfig);
router.patch('/', authMiddleware.authenticate, controller.updateConfig);
router.post('/preview', authMiddleware.authenticate, controller.previewTagGeneration);
router.get('/generated-tag-categories', authMiddleware.authenticate, controller.getGeneratedTagCategories);
router.get('/generated-tags/:tagCategory', authMiddleware.authenticate, controller.getGeneratedTagsByCategory);
router.get('/conversations-by-tags', authMiddleware.authenticate, controller.filterConversationsByTags);

export default router;
