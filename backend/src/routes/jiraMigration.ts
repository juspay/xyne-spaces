import { Router } from 'express';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';
import { JiraMigrationController } from '@/controllers/jiraMigrationController';
import { AccessType } from '@prisma/client';

const router = Router();
const controller = new JiraMigrationController();
const jiraMigrationAdminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

router.post('/preview', authMiddleware.authenticate, jiraMigrationAdminAuth, controller.preview);
router.post('/execute', authMiddleware.authenticate, jiraMigrationAdminAuth, controller.execute);
router.get('/status/:jobId', authMiddleware.authenticate, jiraMigrationAdminAuth, controller.status);
router.post('/stop/:jobId', authMiddleware.authenticate, jiraMigrationAdminAuth, controller.stop);
router.post('/pause/:jobId', authMiddleware.authenticate, jiraMigrationAdminAuth, controller.pause);
router.post('/resume/:jobId', authMiddleware.authenticate, jiraMigrationAdminAuth, controller.resume);
router.get('/history', authMiddleware.authenticate, jiraMigrationAdminAuth, controller.history);

export default router;
