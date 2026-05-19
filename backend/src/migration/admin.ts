import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { StageReconstructionController } from '@/controllers/stageReconstructionController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();
const controller = new StageReconstructionController();
const migrationAdminAuth = authorize('TICKETS', AccessType.ADMIN);

router.post(
  '/reconstruct-stages',
  authMiddleware.authenticate,
  migrationAdminAuth,
  controller.reconstructStages,
);

export default router;
