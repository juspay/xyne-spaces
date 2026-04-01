import { Router } from 'express';
import { authMiddleware } from '@/middleware/auth';
import { GoogleMailController } from '@/controllers/googleMailController';

const router = Router();
const controller = new GoogleMailController();

router.get('/search', authMiddleware.authenticate, controller.searchMessages);
router.get('/sources', authMiddleware.authenticate, controller.listSources);
router.post('/sources', authMiddleware.authenticate, controller.createSource);
router.put('/sources/:sourceId', authMiddleware.authenticate, controller.updateSource);
router.get('/oauth/start', authMiddleware.authenticate, controller.startOAuth);
router.get('/oauth/callback', controller.handleOAuthCallback);
router.post('/sources/:sourceId/start-ingestion', authMiddleware.authenticate, controller.startIngestion);

export default router;
