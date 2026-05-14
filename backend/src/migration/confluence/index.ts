import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';
import { ConfluenceMigrationController } from '@/controllers/confluenceMigrationController';

const router = Router();
const controller = new ConfluenceMigrationController();
const confluenceMigrationAdminAuth = authorize('CONFLUENCE-MIGRATION', AccessType.ADMIN);

router.post('/preview', authMiddleware.authenticate, confluenceMigrationAdminAuth, controller.preview);
router.post('/execute', authMiddleware.authenticate, confluenceMigrationAdminAuth, controller.execute);
router.get('/status/:jobId', authMiddleware.authenticate, confluenceMigrationAdminAuth, controller.status);
router.get('/history', authMiddleware.authenticate, confluenceMigrationAdminAuth, controller.history);

export default router;
